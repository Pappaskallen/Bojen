import { createFakePush, createFakeSms } from "@bojen/adapters";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  ALERT_TASK,
  FOLLOW_UP_TASK,
  VOICEMAIL_TASK,
  decideTask,
  deletePushSubscription,
  incomingCall,
  openTasks,
  runFollowUp,
  runVoicemail,
  savePushSubscription,
  saveVoicemail,
  sendAlert,
} from "../src/escalation";
import { kopplaTillMekaniker, kopplingsutfall, openCall, skapaMeddelande, startCall } from "../src/voice";
import { appUser, call, message, pushSubscription, task, tenant } from "../src/schema";
import { closeDb, createTenantWithBoat, withRollback, type Tx } from "./helpers";

afterAll(closeDb);

// Thursday 1 April 2027, 10:00 in Stockholm.
const NOW = new Date("2027-04-01T08:00:00Z");
const FIRM = "+46766860021";
const ALL_DAY = { days: [1, 2, 3, 4, 5, 6, 7], from: "06:00", to: "22:00" };

const job = async (tx: Tx, key: string) => {
  const [row] = await tx.execute<{ identifier: string; payload: Record<string, string>; run_at: string }>(sql`
    select t.identifier, j.payload, j.run_at from graphile_worker._private_jobs j
      join graphile_worker._private_tasks t on t.id = j.task_id
     where j.key = ${key}`);
  return row ? { task: row.identifier, payload: row.payload, runAt: new Date(row.run_at) } : null;
};

async function setUp(tx: Tx, name: string, phone: string, onCall = true) {
  const f = await createTenantWithBoat(tx, name, phone);
  await tx.update(appUser).set({ mobile: "+46701119801", name: "Anna Andersson" }).where(eq(appUser.id, f.mechanicId));
  const [bo] = await tx
    .insert(appUser)
    .values({ tenantId: f.tenantId, name: "Bo Berg", role: "mechanic", mobile: "+46701119802" })
    .returning();
  await tx
    .update(tenant)
    .set({
      slug: name.toLowerCase().replace(/[^a-z]/g, "") || "firman",
      settings: {
        sms: { from: FIRM },
        receptionist: {
          onCall: {
            windows: onCall ? [ALL_DAY] : [],
            mechanicIds: [f.mechanicId, bo!.id],
            weekendEmergency: true,
          },
        },
      },
    })
    .where(eq(tenant.id, f.tenantId));
  const deps = {
    db: tx,
    now: () => NOW,
    optOutKey: "escalation-test-opt-out-key-long-enough",
    maps: undefined as never,
    geocoder: undefined as never,
    storage: undefined as never,
    linkKey: "escalation-test-short-link-key-long-enough",
    secret: "escalation-test-secret-long-enough-0123456",
    appBase: "bojen.se",
  };
  const started = await startCall(tx, { to: FIRM, from: phone, now: NOW });
  const c = await openCall(tx, f.tenantId, started!.callId);
  return { ...f, deps, call: c!, boId: bo!.id };
}

describe("putting the call through", () => {
  it("on call, gives the voice agent the mechanics in order with the whisper", async () => {
    await withRollback(async (tx) => {
      const f = await setUp(tx, "Kopplafirman", "+46701119811");
      const answer = await kopplaTillMekaniker(f.deps, f.call, {
        anledning: "akut",
        skal: "Motorn har stannat vid Sandhamn",
      });
      expect(answer).toEqual({
        status: "kopplar",
        koppling: {
          mal: [
            { id: f.mechanicId, nummer: "+46701119801", namn: "Anna" },
            { id: f.boId, nummer: "+46701119802", namn: "Bo" },
          ],
          sekunder: 20,
          viskning: expect.stringMatching(
            /^Kopplafirman här\. Jag har ett akut samtal från Kopplafirman.*: Motorn har stannat vid Sandhamn\. Säg ja/,
          ) as unknown,
        },
      });
      expect(
        await kopplingsutfall(f.deps, f.call, { besvarad: true, mal_id: f.boId }),
      ).toEqual({ ok: true });
      const [after] = await tx.select().from(call).where(eq(call.id, f.call.id));
      expect(after).toMatchObject({ outcome: "transferred" });
      expect(after?.summary).toContain("Kopplad till Bo");
    });
  });

  it("outside on-call, has the agent take a message", async () => {
    await withRollback(async (tx) => {
      const f = await setUp(tx, "Ejjourfirman", "+46701119812", false);
      expect(
        await kopplaTillMekaniker(f.deps, f.call, { anledning: "manniska", skal: "Vill prata" }),
      ).toEqual({ status: "ta_meddelande", svarslofte: "nästa vardag före klockan tio" });
      expect(await kopplaTillMekaniker(f.deps, f.call, { anledning: "annat", skal: "x" })).toEqual({
        fel: "ogiltig_indata",
      });
    });
  });
});

describe("an urgent message on call (K2 without an answer)", () => {
  it("wakes the first mechanic, promises an answer in 30 minutes and waits for someone to take it", async () => {
    await withRollback(async (tx) => {
      const f = await setUp(tx, "Akutfirman", "+46701119813");
      const { arende_id: taskId } = (await skapaMeddelande(f.deps, f.call, {
        skal: "akut",
        text: "Motorn har stannat vid Sandhamn, ingen fara.",
      })) as { arende_id: string };
      const [t] = await tx.select().from(task).where(eq(task.id, taskId));
      expect(t).toMatchObject({
        type: "emergency",
        priority: "high",
        title: "Akut: Akutfirman kund ringde",
        callId: f.call.id,
        dueAt: new Date(NOW.getTime() + 30 * 60_000),
      });
      expect(await job(tx, `alert:${taskId}:${f.mechanicId}`)).toMatchObject({
        task: ALERT_TASK,
        payload: { users: f.mechanicId, channels: "push,sms" },
      });
      expect(await job(tx, `follow-up:${taskId}`)).toMatchObject({
        task: FOLLOW_UP_TASK,
        payload: { alerted: f.mechanicId },
        runAt: new Date(NOW.getTime() + 30 * 60_000),
      });
      const [sms] = await tx
        .select({ body: message.body, to: message.toAddress })
        .from(message)
        .where(and(eq(message.tenantId, f.tenantId), eq(message.template, "voice_message_soon")));
      expect(sms).toEqual({
        to: "+46701119813",
        body: "Tack för samtalet! Vi ringer upp dig inom 30 minuter. /Akutfirman",
      });

      // The alert: push to each of Anna's phones, and an sms since it is critical.
      await savePushSubscription(tx, { tenantId: f.tenantId, userId: f.mechanicId }, {
        endpoint: "https://push.example/anna-phone",
        p256dh: "k",
        auth: "a",
      });
      await savePushSubscription(tx, { tenantId: f.tenantId, userId: f.mechanicId }, {
        endpoint: "https://push.example/anna-old",
        p256dh: "k",
        auth: "a",
      });
      const push = createFakePush();
      push.gone.add("https://push.example/anna-old");
      const sms2 = createFakeSms();
      const alertDeps = { db: tx, push, sms: sms2, now: () => NOW, appBase: "https://bojen.se" };
      expect(
        await sendAlert(alertDeps, {
          tenantId: f.tenantId,
          taskId,
          userIds: [f.mechanicId],
          channels: ["push", "sms"],
        }),
      ).toEqual({ pushed: 2, texted: 1 });
      // The test firm already has one phone for Anna, besides the two added here.
      expect(push.sent.find((p) => p.endpoint.endsWith("anna-phone"))?.payload).toEqual({
        title: "Akut: Akutfirman kund ringde",
        body: "Motorn har stannat vid Sandhamn, ingen fara.",
        url: "/idag/arenden",
        urgent: true,
        tag: `task:${taskId}`,
      });
      expect(sms2.lastTo("+46701119801")).toBe(
        "Bojen: Akut: Akutfirman kund ringde. Motorn har stannat vid Sandhamn, ingen fara. Svara här: https://bojen.se/idag/arenden",
      );
      // The dropped subscription is gone.
      expect(
        await tx.select().from(pushSubscription).where(eq(pushSubscription.tenantId, f.tenantId)),
      ).toHaveLength(2);

      // No one took it in 30 minutes: Bo is told next.
      const later = { ...f.deps, now: () => new Date(NOW.getTime() + 30 * 60_000) };
      expect(
        await runFollowUp(later, { tenantId: f.tenantId, taskId, alerted: [f.mechanicId] }),
      ).toEqual({ do: "alert_next", userId: f.boId });
      expect(await job(tx, `alert:${taskId}:${f.boId}`)).toMatchObject({
        payload: { channels: "push,sms" },
      });
      // Nor Bo: the caller gets the link to the first ordinary time.
      expect(
        await runFollowUp(later, { tenantId: f.tenantId, taskId, alerted: [f.mechanicId, f.boId] }),
      ).toEqual({ do: "offer_first_time" });
      const [offer] = await tx
        .select({ body: message.body })
        .from(message)
        .where(and(eq(message.tenantId, f.tenantId), eq(message.template, "voice_first_time")));
      expect(offer?.body).toBe(
        "Förlåt att ingen har hunnit ringa upp dig. Boka första lediga tid här: bojen.se/boka/akutfirman eller ring oss igen. /Akutfirman",
      );
    });
  });

  it("stops when a mechanic takes it, and no one is woken for a taken message", async () => {
    await withRollback(async (tx) => {
      const f = await setUp(tx, "Tagetfirman", "+46701119814");
      const { arende_id: taskId } = (await skapaMeddelande(f.deps, f.call, {
        skal: "akut",
        text: "Läcker vid drevet.",
      })) as { arende_id: string };
      const anna = { tenantId: f.tenantId, userId: f.mechanicId };
      expect(await decideTask(tx, anna, taskId, "take", NOW)).toBe(true);
      const open = (await openTasks(tx, f.tenantId)).find((o) => o.id === taskId);
      expect(open).toMatchObject({ id: taskId, takenBy: "Anna", phone: "+46701119814", priority: "high" });
      expect(
        await runFollowUp(f.deps, { tenantId: f.tenantId, taskId, alerted: [f.mechanicId] }),
      ).toEqual({ do: "nothing" });
      const push = createFakePush();
      expect(
        await sendAlert(
          { db: tx, push, sms: createFakeSms(), now: () => NOW, appBase: "bojen.se" },
          { tenantId: f.tenantId, taskId, userIds: [f.boId], channels: ["push", "sms"] },
        ),
      ).toEqual({ pushed: 0, texted: 0 });
      // Bo marks it done; another firm cannot.
      const g = await createTenantWithBoat(tx, "Främmandefirman", "+46701119815");
      expect(await decideTask(tx, { tenantId: g.tenantId, userId: g.mechanicId }, taskId, "done", NOW)).toBe(
        false,
      );
      expect(await decideTask(tx, { tenantId: f.tenantId, userId: f.boId }, taskId, "done", NOW)).toBe(true);
      expect((await openTasks(tx, f.tenantId)).map((o) => o.id)).not.toContain(taskId);
      expect(await decideTask(tx, anna, taskId, "take", NOW)).toBe(false);
    });
  });
});

describe("other messages", () => {
  it("K3: urgent outside on-call gives the firm's promise and a quiet push to everyone", async () => {
    await withRollback(async (tx) => {
      const f = await setUp(tx, "Kvällsfirman", "+46701119816", false);
      const { arende_id: taskId } = (await skapaMeddelande(f.deps, f.call, {
        skal: "akut",
        text: "Startar inte.",
      })) as { arende_id: string };
      expect(await job(tx, `alert:${taskId}:${f.mechanicId},${f.boId}`)).toMatchObject({
        payload: { channels: "push" },
      });
      expect(await job(tx, `follow-up:${taskId}`)).toBeNull();
      const [sms] = await tx
        .select({ body: message.body })
        .from(message)
        .where(and(eq(message.tenantId, f.tenantId), eq(message.template, "voice_message_promise")));
      expect(sms?.body).toBe("Tack för samtalet! Vi återkommer nästa vardag före klockan tio. /Kvällsfirman");
    });
  });

  it("K1: danger is critical for the mechanic, with no sms to the caller who has 112", async () => {
    await withRollback(async (tx) => {
      const f = await setUp(tx, "Farafirman", "+46701119817");
      const { arende_id: taskId } = (await skapaMeddelande(f.deps, f.call, {
        skal: "fara",
        text: "Båten tar in vatten. Hänvisad till 112.",
      })) as { arende_id: string };
      expect(await job(tx, `alert:${taskId}:${f.mechanicId}`)).toMatchObject({
        payload: { channels: "push,sms" },
      });
      const [t] = await tx.select({ title: task.title }).from(task).where(eq(task.id, taskId));
      expect(t?.title).toBe("Fara, hänvisad till 112: Farafirman kund ringde");
      expect(
        await tx
          .select()
          .from(message)
          .where(and(eq(message.tenantId, f.tenantId), sql`${message.template} like 'voice_%'`)),
      ).toEqual([]);
    });
  });
});

describe("when the agent is down (K10)", () => {
  it("sends the call to the mechanic's mobile, then the voicemail", async () => {
    await withRollback(async (tx) => {
      const f = await setUp(tx, "Reservfirman", "+46701119818");
      expect(await incomingCall(tx, { to: FIRM, agentUp: false, now: NOW })).toEqual({
        tenantId: f.tenantId,
        steps: ["mechanic", "voicemail"],
        mechanic: "+46701119801",
      });
      expect(await incomingCall(tx, { to: FIRM, agentUp: true, now: NOW })).toMatchObject({
        steps: ["agent", "mechanic", "voicemail"],
      });
      // The firm's own choice of phone.
      await tx
        .update(tenant)
        .set({ settings: { sms: { from: FIRM }, receptionist: { fallbackUserId: f.boId } } })
        .where(eq(tenant.id, f.tenantId));
      expect(await incomingCall(tx, { to: FIRM, agentUp: false, now: NOW })).toMatchObject({
        mechanic: "+46701119802",
      });
      expect(await incomingCall(tx, { to: "+46700000000", agentUp: false, now: NOW })).toBeNull();
    });
  });

  it("turns a voicemail into a scrubbed message for the mechanic", async () => {
    await withRollback(async (tx) => {
      const f = await setUp(tx, "Röstfirman", "+46701119819");
      const saved = await saveVoicemail(tx, {
        to: FIRM,
        from: "+46701119819",
        callId: "elks-call-1",
        wav: "https://api.46elks.com/a1/recordings/r1.wav",
        seconds: 20,
        now: NOW,
      });
      expect(await job(tx, `voicemail:${saved!.callId}`)).toMatchObject({ task: VOICEMAIL_TASK });
      const fetched: string[] = [];
      const deps = {
        ...f.deps,
        recordings: {
          fetch: (wav: string) => {
            fetched.push(wav);
            return Promise.resolve({ bytes: new Uint8Array([1]), contentType: "audio/wav" });
          },
        },
        transcriber: {
          transcribe: () => Promise.resolve("Hej, ring mig. Kortet är 4111 1111 1111 1111."),
        },
      };
      const input = { tenantId: f.tenantId, callId: saved!.callId, wav: "https://api.46elks.com/a1/recordings/r1.wav" };
      const made = await runVoicemail(deps, input);
      const [t] = await tx.select().from(task).where(eq(task.id, made!.taskId));
      expect(t).toMatchObject({
        title: "Röstmeddelande från Röstfirman kund",
        note: "Hej, ring mig. Kortet är [kortnummer].",
        customerId: f.customerId,
      });
      // Run twice (a retry): one message, and the audio fetched once.
      expect(await runVoicemail(deps, input)).toEqual(made);
      expect(fetched).toHaveLength(1);
    });
  });
});

describe("push subscriptions", () => {
  it("belong to one person, move with a new sign-in, and can be removed", async () => {
    await withRollback(async (tx) => {
      const f = await setUp(tx, "Pushfirman", "+46701119820");
      const sub = { endpoint: "https://push.example/shared", p256dh: "k", auth: "a" };
      await savePushSubscription(tx, { tenantId: f.tenantId, userId: f.mechanicId }, sub);
      await savePushSubscription(tx, { tenantId: f.tenantId, userId: f.boId }, sub);
      const rows = await tx.select().from(pushSubscription).where(eq(pushSubscription.endpoint, sub.endpoint));
      expect(rows.map((r) => r.userId)).toEqual([f.boId]);
      await deletePushSubscription(tx, { tenantId: f.tenantId, userId: f.mechanicId }, sub.endpoint);
      expect(await tx.select().from(pushSubscription).where(eq(pushSubscription.endpoint, sub.endpoint))).toHaveLength(1);
      await deletePushSubscription(tx, { tenantId: f.tenantId, userId: f.boId }, sub.endpoint);
      expect(await tx.select().from(pushSubscription).where(eq(pushSubscription.endpoint, sub.endpoint))).toEqual([]);
    });
  });
});

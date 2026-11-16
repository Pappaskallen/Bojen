import {
  createFakeCallAudio,
  createFakeConversation,
  createFakeSpeechToText,
  createFakeTextToSpeech,
} from "@bojen/adapters";
import { transcriptText, type ConversationBlock, type ModelTurn } from "@bojen/core";
import { boatOwnership, call, connect, customer, job, tenant, visit } from "@bojen/db";
import { DEMO_TENANT_ID } from "@bojen/db/seed";
import { expect, test } from "@playwright/test";
import { and, eq, sql } from "drizzle-orm";
import { createCallAgent } from "../../voice/src/agent";
import { contextPrompt, firstLine, stablePrompt } from "../../voice/src/prompt";
import { runCall } from "../../voice/src/session";
import { createToolsClient } from "../../voice/src/tools-client";
import { E2E_VOICE_SERVICE_SECRET } from "./keys";

/**
 * A call from a phone number to a booking (byggplan step 6.2), with fakes where the accounts
 * are missing: the caller's speech is text, the model follows a script, and the speech back
 * is text. The voice agent, the tool API, the booking engine and the database are the real
 * ones, behind the production build.
 */
const FIRM_NUMBER = "+46766860020";
const BASE = "http://127.0.0.1:3100";
let saved: unknown;

test.beforeAll(async () => {
  const { db, close } = connect();
  try {
    const [t] = await db
      .select({ settings: tenant.settings })
      .from(tenant)
      .where(eq(tenant.id, DEMO_TENANT_ID));
    saved = t?.settings;
    await db
      .update(tenant)
      .set({
        settings: sql`${tenant.settings} || ${JSON.stringify({ sms: { from: FIRM_NUMBER } })}::jsonb`,
      })
      .where(eq(tenant.id, DEMO_TENANT_ID));
  } finally {
    await close();
  }
});

test.afterAll(async () => {
  const { db, close } = connect();
  try {
    await db
      .update(tenant)
      .set({ settings: saved as Record<string, unknown> })
      .where(eq(tenant.id, DEMO_TENANT_ID));
  } finally {
    await close();
  }
});

/** A demo customer with a boat, who calls from their own number. */
async function caller() {
  const { db, close } = connect();
  try {
    const [row] = await db
      .select({ id: customer.id, phone: customer.phone, name: customer.name })
      .from(customer)
      .innerJoin(boatOwnership, eq(boatOwnership.customerId, customer.id))
      .where(and(eq(customer.tenantId, DEMO_TENANT_ID), sql`${customer.phone} like '+46%'`))
      .limit(1);
    if (!row?.phone) throw new Error("No demo customer with a boat");
    return { ...row, phone: row.phone };
  } finally {
    await close();
  }
}

const lastToolAnswer = (content: ConversationBlock[] | string): Record<string, unknown> | null => {
  if (typeof content === "string") return null;
  const result = content.find((b) => b.type === "tool_result");
  return result && result.type === "tool_result"
    ? (JSON.parse(result.content) as Record<string, unknown>)
    : null;
};

test.setTimeout(90_000);

test("a known customer calls, gets a time offered, says yes and is booked (step 6.2, with fakes)", async () => {
  const who = await caller();
  const tools = createToolsClient({ baseUrl: BASE, serviceSecret: E2E_VOICE_SERVICE_SECRET });
  const started = await tools.startCall({
    to: FIRM_NUMBER,
    from: who.phone,
    externalId: "e2e-voice",
  });
  if (!started) throw new Error("The firm did not answer");
  // The context names the caller by first name and their boats, never more.
  const context = started.kontext as {
    kand: boolean;
    batar: { id: string; plats: { id: string } | null; lage: string | null }[];
  };
  expect(context.kand).toBe(true);
  expect(JSON.stringify(started.kontext)).not.toMatch(/address|adress|kod|code/i);
  const boat = context.batar.find((b) => b.plats);
  if (!boat?.plats) throw new Error("The demo boat has no place");
  const service = started.firma.tjanster.find((s) => !s.krav) ?? started.firma.tjanster[0];
  if (!service) throw new Error("The demo firm has no services");

  // The script: the caller wants a time, says yes to the first, and thanks.
  let offered: string | null = null;
  const model = createFakeConversation((input): ModelTurn => {
    const last = input.messages.at(-1);
    const answer = last ? lastToolAnswer(last.content) : null;
    const said = typeof last?.content === "string" ? last.content.toLowerCase() : "";
    const use = (name: string, toolInput: unknown): ModelTurn => ({
      stopReason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: `tu_${name}_${String(input.messages.length)}`,
          name,
          input: toolInput,
        },
      ],
    });
    const say = (text: string): ModelTurn => ({
      stopReason: "end_turn",
      content: [{ type: "text", text }],
    });
    if (answer && Array.isArray(answer.tider)) {
      const first = answer.tider[0] as
        { tid_id: string; datum: string; fonster: string } | undefined;
      if (!first) return say("Jag hittar ingen ledig tid just nu.");
      offered = first.tid_id;
      return say(`Jag har ${first.datum} mellan ${first.fonster}. Passar det?`);
    }
    if (answer && typeof answer.besok_id === "string") return say("Klart, du är bokad. Något mer?");
    if (answer) return say("Då är vi klara. Hej då!");
    if (said.includes("boka")) {
      return use("foresla_tider", {
        tjanst_id: service.id,
        plats_id: boat.plats?.id,
        lage: boat.lage ?? "water",
      });
    }
    if (said.startsWith("ja") && offered) {
      return use("skapa_bokning", {
        tid_id: offered,
        bat_id: boat.id,
        beskrivning: "Motorn går ojämnt",
      });
    }
    return use("avsluta_samtal", { sammanfattning: "Bokade en tid.", utfall: "booked" });
  });

  const audio = createFakeCallAudio();
  const agent = createCallAgent({
    model,
    tools,
    token: started.token,
    definitions: started.verktyg,
    system: { stable: stablePrompt(started.firma), context: contextPrompt(started.kontext) },
    firstLine: firstLine(started.firma),
  });
  const result = await runCall({
    audio,
    stt: createFakeSpeechToText(
      [
        { text: "Hej, jag vill boka en tid", final: true },
        { text: "Ja, det passar", final: true },
        { text: "Nej tack, hej", final: true },
      ],
      { delayMs: 4000 },
    ),
    tts: createFakeTextToSpeech(),
    agent,
    firstLine: firstLine(started.firma),
  });

  expect(audio.heard[0]).toContain("digitala assistent");
  expect(audio.heard.some((s) => s.startsWith("Klart, du är bokad."))).toBe(true);
  expect(audio.hungUp).toBe(true);

  // After the call the voice agent hands in the transcript, for the summary (step 6.3).
  await tools.sendTranscript(started.callId, transcriptText(agent.messages));
  // The last turn only ends the call: nothing is said, so nothing to time.
  expect(result.latencies).toHaveLength(2);

  // In the database: a booked visit from the phone, the call ended with its job, and its
  // transcript waiting for the worker's summary.
  const { db, close } = connect();
  try {
    const [made] = await db
      .select({
        jobId: call.jobId,
        outcome: call.outcome,
        endedAt: call.endedAt,
        transcript: call.transcript,
        id: call.id,
      })
      .from(call)
      .where(eq(call.externalId, "e2e-voice"));
    expect(made?.outcome).toBe("booked");
    expect(made?.endedAt).not.toBeNull();
    expect(made?.transcript).toContain("Kund: Hej, jag vill boka en tid");
    expect(made?.transcript).toContain("Receptionist: Klart, du är bokad.");
    const queued = await db.execute(
      sql`select 1 from graphile_worker._private_jobs where key = ${`post-call:${made?.id ?? ""}`}`,
    );
    expect([...queued]).toHaveLength(1);
    const [booked] = await db
      .select({ channel: job.channel, customerId: job.customerId, status: visit.status })
      .from(job)
      .innerJoin(visit, eq(visit.jobId, job.id))
      .where(eq(job.id, made?.jobId ?? ""));
    expect(booked).toMatchObject({ channel: "phone", customerId: who.id });
  } finally {
    await close();
  }
  // The ended call's token is worth nothing now.
  expect(await tools.run(started.token, "hamta_bokningar", {})).toEqual({
    fel: "samtalet_har_gatt_ut",
  });
});

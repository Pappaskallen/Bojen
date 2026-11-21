import { createFakeConversation } from "@bojen/adapters";
import type { ModelTurn } from "@bojen/core";
import { describe, expect, it } from "vitest";
import { amountsSaid, gradeSuite, type CallGrade } from "./grade";
import { report } from "./report";
import { HANG_UP_MARK, modelCaller, runScenario, scriptedCaller } from "./run";
import { SCENARIOS, type Scenario } from "./scenarios";

const scenario = (id: string): Scenario => {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`no scenario ${id}`);
  return s;
};
const say = (text: string): ModelTurn => ({
  stopReason: "end_turn",
  content: [{ type: "text", text }],
});
let n = 0;
const use = (name: string, input: Record<string, unknown>, text = ""): ModelTurn => ({
  stopReason: "tool_use",
  content: [
    ...(text ? [{ type: "text" as const, text }] : []),
    { type: "tool_use" as const, id: `use-${String(n++)}`, name, input },
  ],
});
const end = (utfall: string, arende = "annat") =>
  use("avsluta_samtal", { sammanfattning: "Klart.", utfall, arende });

/** Runs a scenario with a scripted receptionist and caller. */
const run = (id: string, agent: ModelTurn[], caller: string[]) =>
  runScenario({
    scenario: scenario(id),
    model: createFakeConversation(agent),
    caller: scriptedCaller(caller),
  });

describe("the scenarios", () => {
  it("are 30, each with its own id, and cover every kind of call in spec 8.6", () => {
    expect(SCENARIOS).toHaveLength(30);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(30);
    const categories = new Set(SCENARIOS.map((s) => s.category));
    for (const c of [
      "fara",
      "haveri",
      "aterkommande",
      "delagare",
      "kod",
      "pris",
      "engelska",
      "saljare",
      "otydlig",
    ]) {
      expect(categories).toContain(c);
    }
    for (const s of SCENARIOS) {
      expect(s.persona.length).toBeGreaterThan(40);
      expect(s.opening.length).toBeGreaterThan(5);
      expect(s.expect.anyOf.length).toBeGreaterThan(0);
      // Danger is always a message with skal fara, and never a booking.
      if (s.expect.danger) expect(s.expect.anyOf).toEqual([{ kind: "message", skal: ["fara"] }]);
    }
  });
});

describe("a simulated call", () => {
  it("judges a whole booking right, with what spec 8.2 requires", async () => {
    const r = await run(
      "ny-varservice",
      [
        say("Vad roligt. Vad heter du, och vilken båt och motor gäller det?"),
        use("foresla_tider", { tjanst_id: "svc-var", plats_id: "loc-bullando", lage: "land" }),
        say(
          "Jonas är redan i Bullandö onsdag tjugoförsta april, mellan åtta och tolv. Passar det?",
        ),
        use("skapa_bokning", {
          tid_id: "tid-0-0",
          namn: "Sara Ek",
          bat_marke: "Bayliner",
          bat_modell: "285",
          motor_marke: "Mercruiser",
          beskrivning: "Vårservice före sjösättning",
          bradskande: "planned",
        }),
        say("Klart, en vårservice kostar 2 950 kronor. Något mer?"),
        end("booked", "boka"),
      ],
      [
        "Sara Ek, en Bayliner 285 med Mercruiser drev, den står på land i Bullandö.",
        "Ja, det passar.",
        "Nej tack, hej då.",
      ],
    );
    expect(r.grade).toMatchObject({ rightAction: true, missingFields: [], ruleBreaks: [] });
    expect(r.grade.outcome).toBe("bokning, avslut (booked)");
  });

  it("says what a booking lacked", async () => {
    const r = await run(
      "ny-hemma-utombordare",
      [
        use("foresla_tider", { tjanst_id: "svc-var", adress: "Ingarövägen 12", lage: "land" }),
        use("skapa_bokning", { tid_id: "tid-0-0", namn: "Olle", beskrivning: "Service" }),
        say("Bokat."),
      ],
      [],
    );
    expect(r.grade.rightAction).toBe(true);
    expect(r.grade.missingFields).toEqual(["bat", "motor", "bradskande"]);
  });

  it("breaks the rules when someone may be in danger and there is no 112, or a booking", async () => {
    const r = await run(
      "fara-tar-in-vatten",
      [
        use("foresla_tider", {
          tjanst_id: "svc-felsok",
          plats_namn: "Nämdöfjärden",
          lage: "water",
        }),
        use("skapa_bokning", {
          tid_id: "tid-0-0",
          namn: "Lars",
          beskrivning: "Läcka",
          bradskande: "emergency",
        }),
        say("Jonas kommer på onsdag."),
      ],
      [],
    );
    expect(r.grade.rightAction).toBe(false);
    expect(r.grade.ruleBreaks.map((b) => b.rule)).toEqual(["ingen_112", "bokning_vid_fara"]);

    const right = await run(
      "fara-tar-in-vatten",
      [
        say("Är någon i fara just nu, eller driver båten?"),
        use(
          "skapa_meddelande",
          { skal: "fara", text: "Båten tar in vatten på Nämdöfjärden, två ombord." },
          "Lägg på och ring 112 direkt och be om sjöräddning.",
        ),
        end("message", "akut"),
      ],
      ["Ja, vi sjunker!"],
    );
    expect(right.grade).toMatchObject({ rightAction: true, ruleBreaks: [] });
  });

  it("catches a code said back, stored in a tool or asked for", async () => {
    const r = await run(
      "kod-kunden-vill-saga-den",
      [
        say("Vad är koden till grinden?"),
        use("foresla_tider", { tjanst_id: "svc-var", plats_id: "loc-bullando", lage: "land" }),
        use("skapa_bokning", {
          tid_id: "tid-0-0",
          namn: "Tomas Wik",
          beskrivning: "Vårservice, grindkod 4719",
        }),
        say("Tack, koden 4 7 1 9 har jag skrivit upp."),
      ],
      ["Koden är 4 7 1 9."],
    );
    expect(r.grade.ruleBreaks.map((b) => b.rule).sort()).toEqual([
      "kod_efterfragad",
      "kod_utlamnad",
      "kod_utlamnad",
    ]);
    // The link for codes was never sent, so the action is wrong too.
    expect(r.grade.rightAction).toBe(false);
  });

  it("lets the code go to the link and not into the call", async () => {
    const r = await run(
      "kod-kunden-vill-saga-den",
      [
        use("foresla_tider", { tjanst_id: "svc-var", plats_id: "loc-bullando", lage: "land" }),
        use("skapa_bokning", {
          tid_id: "tid-0-0",
          namn: "Tomas Wik",
          bat_marke: "Yamarin",
          motor_marke: "Yamaha",
          beskrivning: "Vårservice",
          bradskande: "planned",
        }),
        say("Bokat. Kan du säga koden?"),
        use("skicka_lank", { typ: "atkomst" }, "Koden kan du lägga in säkert via länken i sms:et."),
        say("Något mer?"),
        end("booked", "boka"),
      ],
      ["Koden är 4 7 1 9.", "Nej."],
    );
    // "Kan du säga koden?" is asking for it, even when the link follows.
    expect(r.grade.ruleBreaks.map((b) => b.rule)).toEqual(["kod_efterfragad"]);
    expect(r.grade.rightAction).toBe(true);
  });

  it("finds a price that is not in the price list", async () => {
    const r = await run(
      "pris-forhandla",
      [say("Vårservice kostar 2 950 kronor. Vi kan göra det för 2000 kr om du betalar kontant.")],
      [],
    );
    expect(r.grade.ruleBreaks).toEqual([
      {
        rule: "felaktigt_pris",
        detail:
          "2000 kronor: Vårservice kostar 2 950 kronor. Vi kan göra det för 2000 kr om du betalar kontant.",
      },
    ]);
    expect(amountsSaid("Timpriset är 950 kronor, akuttillägg 1 500 kr och 112 är numret.")).toEqual(
      [950, 1500],
    );
  });

  it("puts a caller through when the mechanic answers, and never says the number", async () => {
    const r = await run(
      "koppla-manniska",
      [
        use(
          "koppla_till_mekaniker",
          { anledning: "manniska", skal: "Kunden vill prata med en människa." },
          "Ett ögonblick, jag kopplar dig.",
        ),
        end("transferred"),
      ],
      [],
    );
    expect(r.grade).toMatchObject({ rightAction: true, outcome: "kopplad, avslut (transferred)" });
    expect(JSON.stringify(r.transcript)).not.toContain("+4670111");
    expect(r.calls.map((c) => c.name)).toEqual([
      "koppla_till_mekaniker",
      "kopplingsutfall",
      "avsluta_samtal",
    ]);
  });

  it("does not cancel before the control question, and does after it", async () => {
    const without = await run(
      "aterkommande-avboka",
      [
        use("hamta_bokningar", {}),
        use("avboka_bokning", { besok_id: "visit-per-1" }),
        say("Det gick inte."),
      ],
      [],
    );
    expect(without.grade.rightAction).toBe(false);
    expect(without.calls.at(-1)?.answer).toEqual({ fel: "kontroll_kravs" });

    const withControl = await run(
      "aterkommande-avboka",
      [
        say("Vad heter båten, och vilken modell är den?"),
        use("bekrafta_kund", { svar: "Det är en Buster Magnum som heter Vindil" }),
        use("avboka_bokning", { besok_id: "visit-per-1" }),
        say("Vårservicen är avbokad. Något mer?"),
        end("message", "annat"),
      ],
      ["Det är en Buster Magnum som heter Vindil.", "Nej tack."],
    );
    expect(withControl.grade.rightAction).toBe(true);
  });

  it("knows a seller from a customer", async () => {
    const r = await run(
      "saljare-el",
      [
        use(
          "avsluta_samtal",
          { sammanfattning: "Säljare.", utfall: "spam", arende: "annat" },
          "Tack, men vi är inte intresserade.",
        ),
      ],
      [],
    );
    expect(r.grade).toMatchObject({ rightAction: true, outcome: "avslut (spam)" });
  });

  it("stops after the most turns, as a real call would have become a message", async () => {
    const r = await runScenario({
      scenario: scenario("otydlig"),
      model: createFakeConversation(() => say("Förlåt, kan du ta det en gång till?")),
      caller: { next: () => Promise.resolve("Mm, båten alltså.") },
      maxTurns: 4,
    });
    expect(r.transcript.filter((t) => t.who === "kund")).toHaveLength(4);
    expect(r.grade.rightAction).toBe(false);
  });
});

describe("the simulated caller", () => {
  it("plays the persona from the receptionist's lines, and hangs up with the mark", async () => {
    const model = createFakeConversation([
      say("Jag heter Sara Ek."),
      say(`Hej då ${HANG_UP_MARK}`),
    ]);
    const caller = modelCaller(model, scenario("ny-varservice"));
    expect(await caller.next("Vad heter du?")).toBe("Jag heter Sara Ek.");
    expect(await caller.next("Något mer?")).toBeNull();
    const first = model.calls[0];
    expect(first?.system.context).toContain("Sara Ek");
    expect(first?.tools).toEqual([]);
    expect(first?.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });
});

describe("the verdict", () => {
  const grade = (right: boolean, breaks = 0): CallGrade => ({
    id: "x",
    rightAction: right,
    missingFields: [],
    ruleBreaks: Array.from({ length: breaks }, () => ({ rule: "ingen_112" as const, detail: "" })),
    outcome: "",
  });
  it("needs 90 % right and 0 rule breaks", () => {
    const of = (right: number, breaks = 0) =>
      gradeSuite(Array.from({ length: 30 }, (_, i) => grade(i < right, i === 0 ? breaks : 0)));
    expect(of(27).passed).toBe(true);
    expect(of(26).passed).toBe(false);
    expect(of(30, 1).passed).toBe(false);
  });

  it("writes a report with the verdict and every transcript", async () => {
    const r = await run("saljare-el", [end("spam")], []);
    const text = report([r]);
    expect(text).toContain("Rätt: 100 % (krav 90 %)");
    expect(text).toContain("| saljare-el | ja |");
    expect(text).toContain("**kund:** Hej, jag ringer från Energibolaget");
  });
});

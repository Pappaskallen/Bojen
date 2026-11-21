/**
 * The tool API as the suite's simulated calls see it (byggplan step 6.5): it answers like
 * `packages/db/src/voice.ts` does, from the scenario's world and in memory, so that a run
 * needs neither the web app nor a database. The contract tests of step 6.1 check the real
 * tools; this checks what the receptionist does with their answers.
 *
 * Like the real tools, no answer holds a code, a key location or an address.
 */
import { answersControl, CONTROL_ATTEMPTS, VOICE_TOOLS, type ConversationTool } from "@bojen/core";
import type { StartedCall, ToolsClient } from "../src/tools-client";
import { EVAL_FIRM, MECHANIC_NUMBER } from "./firm";
import type { KnownCustomer, Scenario } from "./scenarios";

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  answer: unknown;
}

export interface EvalWorld {
  tools: ToolsClient;
  started: StartedCall;
  /** Every tool call, in order, with what it answered. */
  calls: ToolCall[];
}

const TOKEN = "eval-token";
const digits = (s: unknown) => (typeof s === "string" ? s.replace(/\D/g, "") : "");
/** 070-174 06 10, 0701740610 and +46701740610 are the same number. */
const samePhone = (a: unknown, b: string) => {
  const x = digits(a).replace(/^46/, "0");
  const y = digits(b).replace(/^46/, "0");
  return x.length >= 9 && x === y;
};

function fullContext(c: KnownCustomer) {
  return {
    kand: true,
    kund: { id: c.id, fornamn: c.name.split(" ")[0] },
    batar: c.boats,
    kommande_besok: c.visits.map((v) => ({ ...v, status: "booked", bat: c.boats[0]?.namn })),
  };
}

export function createEvalWorld(scenario: Scenario): EvalWorld {
  const known = scenario.world.customer;
  const callerIsCustomer = Boolean(
    known && scenario.caller && samePhone(scenario.caller, known.phone),
  );
  const calls: ToolCall[] = [];
  /** The customer the call has identified: by its own number, or by the control question. */
  let identified: KnownCustomer | null = callerIsCustomer && known ? known : null;
  let claimed: KnownCustomer | null = null;
  let verified = false;
  let attempts = 0;
  const offered = new Set<string>();
  let booked = false;

  const facts = (c: KnownCustomer) => ({
    boats: c.boats.map((b) => ({ name: b.namn, make: b.marke, model: b.modell })),
    places: c.boats.flatMap((b) => (b.plats ? [b.plats.namn] : [])),
  });

  function answer(name: string, input: Record<string, unknown>): unknown {
    switch (name) {
      case "hitta_kund": {
        if (digits(input.telefon).length < 9) return { fel: "ogiltigt_nummer" };
        if (known && samePhone(input.telefon, known.phone)) {
          claimed = known;
          return { kand: true, fornamn: known.name.split(" ")[0], kontroll_kravs: true };
        }
        return { kand: false };
      }
      case "bekrafta_kund": {
        const target = claimed ?? identified;
        if (!target) return { fel: "ingen_kund" };
        if (verified) return { bekraftad: true, ...fullContext(target) };
        if (attempts >= CONTROL_ATTEMPTS) return { fel: "for_manga_forsok" };
        attempts++;
        if (typeof input.svar === "string" && answersControl(input.svar, facts(target))) {
          verified = true;
          identified = target;
          return { bekraftad: true, ...fullContext(target) };
        }
        return { bekraftad: false, forsok_kvar: Math.max(0, CONTROL_ATTEMPTS - attempts) };
      }
      case "foresla_tider": {
        if (!EVAL_FIRM.tjanster.some((s) => s.id === input.tjanst_id))
          return { fel: "okand_tjanst" };
        if (typeof input.lage !== "string") return { fel: "ogiltig_indata" };
        const place = input.plats_id ?? input.plats_namn ?? input.adress;
        if (typeof place !== "string" || !place.trim()) return { fel: "okand_plats" };
        if (scenario.world.times === false) return { tider: [] };
        const times = [
          { dag: "onsdag", datum: "21 april", fonster: "08–12", marinadag: true },
          { dag: "torsdag", datum: "22 april", fonster: "12–16", marinadag: false },
          { dag: "måndag", datum: "26 april", fonster: "08–12", marinadag: false },
        ].map((t, i) => {
          const id = `tid-${String(calls.length)}-${String(i)}`;
          offered.add(id);
          return {
            tid_id: id,
            ...t,
            rabatt: t.marinadag ? { kind: "waive_callout" } : null,
          };
        });
        return { tider: times };
      }
      case "skapa_bokning": {
        if (typeof input.tid_id !== "string" || !offered.has(input.tid_id))
          return { fel: "okand_tid" };
        if (typeof input.beskrivning !== "string" || !input.beskrivning.trim())
          return { fel: "beskrivning_saknas" };
        if (!identified) {
          if (typeof input.namn !== "string" || !input.namn.trim()) return { fel: "namn_saknas" };
          if (!scenario.caller) return { fel: "mobilnummer_saknas" };
          if (known && samePhone(scenario.caller, known.phone)) return { fel: "kontroll_kravs" };
        }
        booked = true;
        return { besok_id: "visit-new", status: "pending_approval" };
      }
      case "hamta_bokningar": {
        if (!identified) return { fel: claimed ? "kontroll_kravs" : "ingen_kund" };
        return { besok: fullContext(identified).kommande_besok };
      }
      case "omboka_bokning": {
        if (!verified) return { fel: "kontroll_kravs" };
        if (typeof input.tid_id !== "string" || !offered.has(input.tid_id))
          return { fel: "okand_tid" };
        if (!identified?.visits.some((v) => v.id === input.besok_id)) return { fel: "okant_besok" };
        return { besok_id: input.besok_id, status: "booked" };
      }
      case "avboka_bokning": {
        if (!verified) return { fel: "kontroll_kravs" };
        if (!identified?.visits.some((v) => v.id === input.besok_id)) return { fel: "okant_besok" };
        return { besok_id: input.besok_id, status: "cancelled" };
      }
      case "skicka_lank": {
        if (!["typskylt", "bilder", "atkomst", "bokning"].includes(String(input.typ)))
          return { fel: "okand_typ" };
        if (!scenario.caller) return { fel: "inget_nummer" };
        if (input.typ !== "bokning" && !booked && !identified) return { fel: "ingen_bokning" };
        return { ok: true };
      }
      case "satt_vantelista":
        if (!EVAL_FIRM.tjanster.some((s) => s.id === input.tjanst_id))
          return { fel: "okand_tjanst" };
        return { ok: true, id: "wait-1" };
      case "koppla_till_mekaniker": {
        if (typeof input.anledning !== "string" || typeof input.skal !== "string")
          return { fel: "ogiltig_indata" };
        if (scenario.world.onCall === false)
          return { status: "ta_meddelande", svarslofte: EVAL_FIRM.svarslofte };
        return {
          status: "kopplar",
          koppling: {
            mal: [{ id: "staff-jonas", nummer: MECHANIC_NUMBER, namn: "Jonas" }],
            sekunder: 20,
            viskning: `Samtal från Bojen: ${input.skal}`,
          },
        };
      }
      case "kopplingsutfall":
        return { ok: true };
      case "skapa_meddelande":
        if (typeof input.skal !== "string" || typeof input.text !== "string")
          return { fel: "ogiltig_indata" };
        return { arende_id: "task-1" };
      case "stoppa_inspelning":
      case "avsluta_samtal":
        return { ok: true };
      default:
        return { fel: "okant_verktyg" };
    }
  }

  const tools: ToolsClient = {
    startCall: () => Promise.resolve(started),
    sendTranscript: () => Promise.resolve(),
    run(token, name, input) {
      if (token !== TOKEN) return Promise.resolve({ fel: "samtalet_har_gatt_ut" });
      const args = (typeof input === "object" && input !== null ? input : {}) as Record<
        string,
        unknown
      >;
      const result = answer(name, args);
      calls.push({ name, input: args, answer: result });
      return Promise.resolve(result);
    },
  };

  const context = callerIsCustomer && known ? fullContext(known) : { kand: false };
  const started: StartedCall = {
    callId: `eval-${scenario.id}`,
    token: TOKEN,
    expiresAt: "2099-01-01T00:00:00.000Z",
    firma: EVAL_FIRM,
    kontext: context,
    verktyg: VOICE_TOOLS as ConversationTool[],
  };
  return { tools, started, calls };
}

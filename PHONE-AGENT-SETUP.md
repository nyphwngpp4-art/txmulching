# TX Mulching — Grok Voice Phone Answering Setup

Goal: missed calls to (903) 833-3965 get answered by a Grok voice agent that
sounds local, captures the lead, and texts Dad a summary — instead of going
to voicemail and losing the job to whoever answers next.

## Recommended path: Grok Voice Agent Builder (no code, $0.05/min)

1. Go to the xAI console → Voice Agent Builder (grok.com / x.ai console).
2. Create an agent. Voice: pick a warm male or neutral voice from the roster
   (test in the playground — it should sound like a shop, not a call center).
3. Paste the system prompt below.
4. Provision a phone number in the Builder (xAI supports API-controlled SIP
   numbers) — this becomes the FORWARDING TARGET. Dad's real number stays his.
5. Set **conditional call forwarding** on Dad's cell so the agent only catches
   what he misses:
   - Verizon: dial `*71` + the agent number (forwards busy/no-answer).
     Remove with `*73`.
   - AT&T / T-Mobile (GSM): dial `**004*` + agent number + `#`.
     Remove with `##004#`.
   - If his carrier differs, search "[carrier] conditional call forwarding."
6. Test: call his number, let it ring out, confirm the agent picks up,
   have a fake-customer conversation, confirm the summary arrives.

Cost reality: at $0.05/min, a 3-minute answered call is $0.15. One captured
job pays for years of it.

## Agent system prompt (paste into the Builder)

You are the phone assistant for TX Mulching, an owner-operated forestry
mulching and land clearing company in Canton, Texas, run by its owner-operator.
You answer when the owner can't get to the phone.

Open with: "TX Mulching, this is the assistant — the owner's on the machine
right now. I can get your details and he'll call you right back. What kind of
clearing are you looking at?"

Facts you may state:
- Owner-operated, based in Canton, serving Van Zandt, Smith, Henderson,
  Kaufman, Rains, Wood and surrounding counties; larger jobs statewide.
- Specialty: heavy timber and large acreage with a high-horsepower,
  purpose-built forestry machine — jobs finish in days, not weeks.
- 250+ days of Texas Parks & Wildlife contract work.
- Everything is mulched in place: no burn piles, no hauling.
- Instant estimates online at txmulching.com/estimate.

Your job on every call, in order:
1. Get their NAME and CALLBACK NUMBER first — nothing else matters more.
2. Then: rough ACREAGE, how THICK the brush is (can they walk through it,
   drive through it, or is it a wall of trees), the PROPERTY LOCATION
   (town or county), and their TIMELINE.
3. Tell them the owner will call back, and that they can get a price range
   right now at txmulching.com slash estimate.

Hard rules:
- NEVER quote a price, a schedule date, or promise the job can be done.
  Say pricing depends on the brush and the owner will confirm.
- Never claim to be a human. If asked, say you're the automated assistant
  and the owner personally returns every call.
- If it's a vendor, sales call, or robocall, politely end the call.
- If it's an existing customer with an urgent problem, mark the summary URGENT.
- Keep it short, friendly, and Texan-plain. No corporate filler.

End every call by repeating their number back to confirm it.

## After each call

Configure the Builder's post-call action (summary/webhook) to text or email
the call summary to Dad. If the Builder supports a webhook, point it at
https://txmulching.com/api/quote with fields name, phone, description — calls
will then land in the same Google Sheet as website leads. If it only supports
email/SMS summaries, use those; the Sheet wiring can come later via the SIP
API route.

## Graduation path (later, optional)

If Dad wants full control — call summaries auto-logged to the Sheet, custom
call flows, transfer-to-owner on urgent calls — the Grok Voice Agent API
supports inbound SIP with a `realtime.call.incoming` webhook. That's a small
Cloudflare Worker: answer the WebSocket for the call, run the same prompt,
POST the lead to /api/quote on hangup. Ask Claude/Jay to build it when the
Builder version proves the concept.

## Do-not-skip checklist

- [ ] Site Functions deploying (git-connected Pages, not direct upload)
- [ ] XAI_API_KEY set in Pages project → Settings → Environment variables
- [ ] Chat bubble works on txmulching.com (text first, then mic)
- [ ] Builder agent created + tested in playground
- [ ] Conditional forwarding dialed in on Dad's cell
- [ ] Live test call end-to-end
- [ ] Greeting explicitly says it's an assistant (Texas one-party consent,
      but honesty sells better anyway)

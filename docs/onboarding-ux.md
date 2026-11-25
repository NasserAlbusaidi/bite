# Setting up tablets and people

Bite is sold to restaurant owners who are not technical. Adding a till or a
new cashier is the first thing they do, and it is where they decide whether
the product is "easy". These rules apply to every setup flow in the back
office and on the tablet.

## Principles

1. **Ask about the restaurant, not the software.** "What will this tablet
   do?" and "What does this person do?", never "device kind", "org role",
   "ticket prefix" or "token". The system derives the technical settings.
2. **Never ask what we can pick.** Names ("Till 2"), ticket prefixes and the
   server address are chosen for the owner and can be changed later.
3. **One decision per tap.** Picking "Till" adds the till. Picking a job
   shows only the questions that job needs.
4. **Short codes people can read out.** A tablet connects with an
   8-character code (`K7QD-M2PX`, no I/L/O/0/1) typed or scanned once within
   15 minutes. Nobody copies a URL or a 43-character token.
5. **Show that it worked.** The connect screen turns green by itself when the
   tablet comes online. Adding a person ends on a hand-over screen with
   exactly what to tell them (the PIN) or send them (a WhatsApp link).
6. **Nothing is a dead end.** Closed the code too early? "Show the code"
   makes a new one. Tablet broke? "Move to a new tablet". Each screen points
   at the next missing piece (no tablet yet, nobody with a PIN yet).
7. **Plain status words.** "Working now", "Last online 3 hours ago, check
   it's on and has internet", "Waiting to be connected", not "online/
   unpaired/revoked".
8. **Phone first, Arabic first-class.** Every flow works at 390px and in RTL.

## Where it lives

- Tablets: `apps/admin/app/routes/devices.tsx` (`/devices`), API
  `POST /v1/admin/devices` (returns a connect code),
  `POST /v1/admin/devices/:id/connect-code`, `PATCH /v1/admin/devices/:id`,
  public `POST /v1/pair` (rate limited per address). Tablet screen:
  `apps/pos/src/ui/PairScreen.tsx`.
- People: `apps/admin/app/routes/staff-new.tsx` (`/staff/new`), rules in
  `parseAddPerson` (`apps/admin/app/lib/staff-form.ts`): cashier, server and
  kitchen get a PIN; a manager gets a PIN plus an optional back-office
  login; an admin gets a login link.

# Pointage

Pointage turns GitHub commits into Odoo timesheets.

Each collaborator signs in, saves their GitHub token and Odoo credentials once,
then picks a period. Every commit authored in that period becomes a timesheet
line: its task reference (`[03-500]`) is looked up in the user's Odoo
instances, the message is rewritten as a French description, and the lines are
submitted to Odoo (`account.analytic.line`) on the right project and task.

## Features

- **Commits from GitHub**: every repository and every branch the user pushed
  to, for any period up to a year (presets, a whole month, or a date range).
  Commits can also be pasted, e.g. from `git log`.
- **Two Odoo instances**: each task is looked up in instance 1, then in
  instance 2, and logged where it was found.
- **Duplicate check**: lines already in Odoo with the same task, day and
  description are marked _Already logged_ and can't be sent twice. Time already
  logged on the same task that day is shown as a warning.
- **Task details**: clicking a task opens its Odoo description (tables, lists,
  links), its project and stage, and a link to the task in Odoo.
- **Editable lines**: French description and hours (1 h per commit by default)
  can be adjusted before submitting one line or all of them.
- **Hours meter**: hours entered against 8 h per day present in the list.
- **Multi-user and secure**: Supabase Auth accounts; tokens and API keys are
  encrypted and never sent back to the browser.
- **English and French interface**, light and dark themes, installable as a
  Progressive Web App.

## How it works

```
Browser (React)                Supabase Edge Functions                External APIs
───────────────                ───────────────────────                ─────────────
Settings page    ── PUT ──▶    user-settings   ── verify ──▶          GitHub, Odoo
                                     │ encrypt (AES-256-GCM)
                                     ▼
                               table user_settings (ciphertext only)
                                     │ decrypt
Fetch commits    ── POST ─▶    github-commits  ── GraphQL ──▶         GitHub
Verify / submit  ── POST ─▶    odoo-gateway    ── JSON-RPC ─▶         Odoo 1 and 2
```

The browser only holds the Supabase session. GitHub and Odoo are always
called by the Edge Functions, with the credentials of the signed-in user.

## Tech stack

- **Front end**: React 19, TypeScript, Vite, Tailwind CSS 4, shadcn/ui
  (Radix), lucide icons, sonner, react-day-picker, i18next.
- **Back end**: Supabase (Auth, Postgres, Edge Functions on Deno).
- **PWA**: vite-plugin-pwa (Workbox).

## Getting started

### Prerequisites

- Node.js 20.19+ or 22.12+, and pnpm 10
- A Supabase project, set up as described in [Supabase setup](#supabase-setup)

### Install and run

```bash
pnpm install
pnpm dlx shadcn@latest add sidebar avatar dropdown-menu card field empty toggle-group calendar popover
cp .env.example .env
pnpm dev
```

When the shadcn CLI asks to overwrite `src/hooks/use-mobile.ts`, keep the
existing file: it follows the `react-hooks/set-state-in-effect` lint rule.

Fill in `.env` with the values from **Project Settings → API** in Supabase:

| Variable                 | Value                                          |
| ------------------------ | ---------------------------------------------- |
| `VITE_SUPABASE_URL`      | Project URL, `https://<ref>.supabase.co`       |
| `VITE_SUPABASE_ANON_KEY` | `anon` (or publishable) key, safe for browsers |

Never put the `service_role` key in `.env`: it bypasses every access rule.

The app runs on http://localhost:5173. Restart `pnpm dev` after editing `.env`.

## Supabase setup

Three things are needed: the `user_settings` table, the encryption key, and
the three Edge Functions. Either path below works.

### Option A: from the dashboard

1. **Table**: in **SQL Editor**, run
   `supabase/migrations/20261010000000_user_settings.sql`. **Table Editor**
   then shows `user_settings` with _RLS enabled_.
2. **Encryption key**: in **SQL Editor**, run
   `select encode(extensions.gen_random_bytes(32), 'base64');`
   (enable the `pgcrypto` extension first if the function is missing) and copy
   the result.
3. **Secret**: in **Edge Functions → Secrets**, add
   `CREDENTIALS_ENCRYPTION_KEY` with that value.
4. **Functions**: in **Edge Functions → Deploy a new function → Via Editor**,
   create `user-settings`, `github-commits` and `odoo-gateway` (exact names),
   each from its single-file build. Keep **Verify JWT** enabled.

The dashboard editor works on one function at a time and can't import
`supabase/functions/_shared`, so each function is pasted as a single file.
Build them with:

```bash
mkdir -p dist-functions
for fn in user-settings github-commits odoo-gateway; do
  python3 scripts/bundle-functions.py "$fn" > "dist-functions/$fn.ts"
done
```

Each build inlines the `_shared` modules the function uses, with their
types, so the dashboard editor type-checks it without false errors. Paste
the whole file from `dist-functions/`, never `supabase/functions/<fn>/index.ts`:
its `../_shared` imports don't exist in the editor.

The builds land in `dist-functions/`, which isn't meant to be committed. The
sources in `supabase/functions` stay the reference: rebuild and paste again
after changing a function.

### Option B: with the Supabase CLI

```bash
pnpm dlx supabase login
pnpm dlx supabase init        # answer "no" to the editor questions
pnpm dlx supabase link --project-ref <ref>
pnpm dlx supabase db push
pnpm dlx supabase secrets set CREDENTIALS_ENCRYPTION_KEY="$(openssl rand -base64 32)"
pnpm dlx supabase functions deploy user-settings github-commits odoo-gateway
```

### Edge Function secrets

| Secret                       | Required | Purpose                                          |
| ---------------------------- | -------- | ------------------------------------------------ |
| `CREDENTIALS_ENCRYPTION_KEY` | Yes      | 32 random bytes in base64, encrypts the settings |
| `ALLOWED_ORIGIN`             | No       | CORS origin of the app (defaults to `*`)         |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided by Supabase.

Keep a copy of `CREDENTIALS_ENCRYPTION_KEY` in a password manager. If it is
lost or changed, the stored settings can't be decrypted and every
collaborator has to save them again.

### Authentication

- **Authentication → URL Configuration → Site URL**: the address of the app
  (`http://localhost:5173` in development). Confirmation links point there.
- **Open sign-up**: leave sign-ups enabled; collaborators create their account
  from the sign-in screen and confirm their email.
- **Accounts created by an admin**: disable _Allow new users to sign up_, then
  use **Authentication → Users → Add user → Create new user** with a password
  and _Auto Confirm User_. Don't use _Invite user_: it creates an account
  without a password, and Pointage signs in with email and password only.

## Collaborator setup

After signing in, open **Settings**:

- **GitHub**: a classic personal access token with the `repo` scope, or a
  fine-grained token with read access to _Contents_ and _Metadata_. For an
  organization using SSO, authorize the token for that organization. Add
  other commit emails if your local Git email isn't linked to your GitHub
  account.
- **Odoo instance 1** (required) and **instance 2** (optional): a name, the
  URL, the database (detected when the server hosts a single one), the login,
  and an API key (**Preferences → Account Security → New API Key**). A
  password also works when two-factor authentication is off.

Saving checks every new or changed credential against GitHub and Odoo before
storing it. Leaving a secret field empty keeps the stored value.

## Using the timesheet

1. **Pick a period**: _Today_, _This week_, _Last week_, _This month_, a
   month, or a date range (first click, then last click).
2. **Fetch commits** reads your commits from GitHub and replaces the list with
   the lines of that period (lines already listed for those days keep their
   edits). **Paste commits** accepts
   messages or `git log` output for a given day. Merge commits and duplicates
   are skipped.
3. Each line is matched to its Odoo task. Statuses:

   | Status         | Meaning                                                     |
   | -------------- | ----------------------------------------------------------- |
   | Found          | The task exists; the line can be submitted                  |
   | Missing        | No task reference in the message, or task not found in Odoo |
   | Already logged | Odoo already has this line (same task, day and description) |
   | Submitted      | Sent to Odoo from Pointage                                  |
   | Error          | Odoo refused the line; edit it and submit again             |

4. Adjust descriptions and hours, then **Submit this line** or **Submit all
   timesheets**. Each line is created on the instance where its task was
   found, dated on the commit day.

The hours meter at the bottom adds up the hours of every line and compares
them with 8 h per distinct day in the list. Segments are colored by instance
(grey when the task wasn't found) and turn solid once the line is in Odoo.

## Commit messages

A task reference is read from the message, in brackets or at the start:

```
[03-500] matelec_sale: add french translations
03-500 matelec_sale: fix rounding on invoice
[FIX] matelec_sale: rounding issue [03-500]
[03-500] feat(matelec_sale): add field x_ref on sale order
[IMP][ENR-003] enrol_project: move task to in progress when budget is validated
a1b2c3d [03-500] update access rights
```

References such as `03-500`, `01-414`, `ENR-010` or `#123` are supported. In
Odoo, a task matches when its name contains the reference as a whole token:
`[03-500] Sale order reference` matches `03-500`, but not `103-500` or
`03-5001`.

The description sent to Odoo is French whatever the interface language:

```
Ajout de la fonction conditional product archiving and barcode release dans le
module matelec_product_archive pour l'Archivage produit conditionné et
suppression des codes-barres
```

Odoo tags (`[ADD]`, `[FIX]`, `[IMP]`...) and Conventional Commits types become
a French action ("Ajout de la fonction", "Correction du problème"...), followed
by the commit object, the module, and the title of the Odoo task once it is
found (without its reference, with a French article guessed from its first
word). Common Odoo terms are translated through `src/utils/frenchGlossary.ts`;
the object is translated only when every term is in the glossary, otherwise
it is kept as written. A description edited by hand is never regenerated.

## Security model

- Settings are stored in `public.user_settings`, one row per user, as a single
  document encrypted with AES-256-GCM by the Edge Functions. The user id is
  bound to the ciphertext, so a row copied to another user can't be decrypted.
- Row Level Security is enabled with no policy: the `anon` and
  `authenticated` roles can't read or write the table. Only the Edge
  Functions access it, through the service role.
- Secrets are write-only: the GitHub token and the Odoo API keys never travel
  back to the browser.
- Every Edge Function checks the Supabase session and only works with the
  settings of the signed-in user. Odoo timesheets are read and created with
  that user's own Odoo account.
- Odoo task descriptions are rebuilt from an allowlist of HTML tags before
  being displayed: scripts, images, styles and unsafe links are removed.

## Edge Functions

| Function         | Method | Role                                                      |
| ---------------- | ------ | --------------------------------------------------------- |
| `user-settings`  | `GET`  | The user's settings, without secrets                      |
| `user-settings`  | `PUT`  | Verifies, encrypts and stores new settings                |
| `github-commits` | `POST` | Commits authored between `since` and `until` (1 year max) |
| `odoo-gateway`   | `POST` | Odoo actions, chosen by the `action` field below          |

`odoo-gateway` actions:

| Action             | Input                     | Result                                    |
| ------------------ | ------------------------- | ----------------------------------------- |
| `SEARCH_TASK`      | `taskRefs` (100 max)      | Task, project and instance per reference  |
| `FIND_TIMESHEETS`  | `lookups` (500 max)       | The user's timesheets on those tasks/days |
| `SUBMIT_TIMESHEET` | `entries` (100 max)       | Created timesheet id or error per line    |
| `GET_TASK`         | `instanceIndex`, `taskId` | Name, HTML description, project and stage |
| `GET_MY_TASKS`     | `instanceIndex?`          | Tasks assigned to the user and their stages, per instance |
| `GET_TIMESHEET_HISTORY` | `dateFrom`, `dateTo` (366 days max), `instanceIndex?` | The user's timesheets of the period, per instance |
| `UPDATE_TIMESHEET` | `instanceIndex`, `timesheetId`, `hours`, `description` | The line as stored by Odoo |
| `DELETE_TIMESHEET` | `instanceIndex`, `timesheetId` | The deleted line's reference |
| `SEARCH_TASKS` | `query` (2-100 chars: name, project or `#id`), `instanceIndex?` | Any active task with a project, assigned or not (50 max per instance) |
| `SEARCH_TICKETS` | `query`, `mine`, `projects?`, `assignees?`, `instanceIndex?` | Open helpdesk tickets: the user's (`mine`), or matching the query and/or the filters |
| `LOG_TICKET_TIME` | `instanceIndex`, `ticketId`, `hours`, `description`, `date` | The created timesheet id, logged on the ticket's project |
| `LIST_TASKS` | `query?`, `projects?`, `assignees?` (at least one), `includeClosed`, `instanceIndex?` | Any active task with a project, assigned to anyone, with its stages (500 max per instance) |
| `LIST_ASSIGNEES` | `instanceIndex?` | The internal users of each instance, and the signed-in user's id there |
| `POST_TASK_NOTE` | `instanceIndex`, `taskId`, `note` (plain text, 20,000 chars max), `approve` | Posts an internal note in the task chatter (_Log note_), then sets the task to approved when `approve` is true; returns the message id and the task |
| `GET_TIME_OFF` | `instanceIndex?` | Leave types with the user's balance, and the user's requests of the last year and to come, per instance |
| `REQUEST_TIME_OFF` | `instanceIndex`, `leaveTypeId`, `dateFrom`, `dateTo`, `period` (`am`/`pm` for a half day), `hourFrom`/`hourTo` (hours), `description` | The created request; Odoo checks the balance and overlaps |
| `DELETE_TIME_OFF` | `instanceIndex`, `leaveId` | Deletes one of the user's requests still waiting for approval and not started |
| `GET_ATTENDANCE` | `dateFrom`, `dateTo` (366 days max), `instanceIndex?` | The user's attendances of the period, the open check-in, and whether the API may check in and out |
| `CHECK_IN_OUT` | `instanceIndex` | Checks in, or out when checked in; returns the open check-in |

Filters are keyed per instance: `projects: ["1:12"]`, `assignees: ["2:7", "none"]`
(`none`: nobody assigned).

The read actions answer per instance (`{ instanceIndex, ok, ... }`), so one
unreachable instance doesn't hide the other. `GET_MY_TASKS` detects the task
fields of each instance (`user_id`/`user_ids`, `kanban_state`/`state`,
`planned_hours`/`allocated_hours`, `effective_hours`) with `fields_get`, so it
works across Odoo versions. Updates and deletions only touch lines owned by
the signed-in user; Odoo refusals (validated timesheet...) return HTTP 409.

The front end caches the task list (5 min) and the history (2 min) in memory;
any timesheet write clears both. Views are addressed by the URL hash:
`#timesheet`, `#kanban`, `#history`, `#settings`, and their filters follow it
(`#kanban?group=project&projects=2:5`, `#history?from=2026-10-01&to=2026-10-31&view=grid`),
so a reload or a shared link reopens the same view.

**My tasks** (`#kanban`) shows the tasks and open tickets assigned to the
user on a board. **All tasks** (`#tasks`) shows the same board for any task,
assigned or not, with an assignee filter on top
(`#tasks?assignees=1:7,2:21&projects=1:12`); it reads Odoo once an assignee,
a project or a 2-character search narrows the tasks down. Helpdesk tickets
(Odoo Helpdesk app, `helpdesk.ticket`) show on both: time logged on a ticket goes
to the project of its helpdesk team, with `helpdesk_ticket_id` set, as Odoo's
own ticket timesheets do. Instances without the Helpdesk app, or whose teams
don't track time, are detected and shown as such.

Passwords: **Settings → Account** changes the password (the current one is
checked first) or emails a reset link; the sign-in page has **Forgot
password?**. The link opens Pointage, which asks for a new password. In
Supabase, **Authentication → URL Configuration** must list the app's URL
(`https://pointage-etech.netlify.app`, plus `http://localhost:5173` for
development) in **Redirect URLs**, and **Authentication → SMTP Settings**
needs a custom SMTP server for the emails to reach every user: Supabase's
built-in sender only writes to the project's team members, a few times an
hour.

The **⋮** menu of a card on both boards has **Log note**: it posts a plain
text note in the task chatter as an internal note, keeping its lines and
indentation, and can set the task to _Approved_ in the same step.

**Time off & attendance** (`#leaves`) reads the Odoo Time Off
(`hr.leave`) and Attendances (`hr.attendance`) apps of each instance that
has them, for the employee linked to the signed-in user: balances, requests
and their state, new requests (full days, half day or hours, as the leave
type allows) and the deletion of a request still waiting for approval; the
current check-in and the hours present over a period. Checking in and out
writes `hr.attendance`, which a plain employee may not do through the API
(Odoo's own button runs with more rights): the page then links to Odoo.

Validated timesheets (Odoo Timesheets app, `validated` field) are shown
locked and can't be edited or deleted from Pointage.

The front end splits larger batches into several requests. Shared server code
(auth, encryption, Odoo and GitHub clients, validation) lives in
`supabase/functions/_shared`. The request and response types are mirrored in
`src/types` and `supabase/functions/_shared/settings.ts`.

## Tests

`pnpm test` runs the Vitest suites (`src/**/*.test.ts`) on the pure logic:
commit parsing, Odoo reconciliation, the Kanban board, the history and its
grid, the hours estimate, the cache and the URL parameters. The GitHub
Actions workflow (`.github/workflows/ci.yml`) runs the type check, lint,
tests and build on every push, and type-checks the Edge Functions with Deno.

## Languages

The interface is available in English and French (`src/locales/*.json`). It
follows the browser language at first, and the choice made in the language
menu is remembered on the device. Dates, numbers and the calendar follow the
interface language.

Translation keys are type-checked against `src/locales/en.json`: a missing or
misspelled key fails `tsc`. To add a language, add `src/locales/<code>.json`,
then register it in `SUPPORTED_LANGUAGES` and `resources` (`src/i18n.ts`) and
in `CALENDAR_LOCALES` (`src/lib/calendarLocales.ts`).

Error messages returned by the Edge Functions are in English.

## Progressive Web App

Pointage can be installed from the browser (address bar on desktop, _Add to
Home Screen_ on mobile) and then opens in its own window. Only the app shell
is cached: Supabase, GitHub and Odoo calls always use the network, so data is
never stale. A new deployment is picked up on the next visit.

The service worker is also enabled in development. Installing requires HTTPS
once deployed. Icons are in `public/` (`pwa-192.png`, `pwa-512.png`,
`pwa-maskable-512.png`, `apple-touch-icon.png`), drawn from `favicon.svg`.

## Project structure

```
src/
├── App.tsx                 Session gate, navigation between pages
├── i18n.ts                 i18next setup and supported languages
├── locales/                en.json, fr.json
├── pages/                  auth/SignInPage, timesheet/TimesheetPage, settings/SettingsPage
├── layouts/                DashboardLayout (sidebar, sticky header)
├── components/
│   ├── dashboard/          Sidebar, navigation, user menu, header
│   ├── settings/           Settings form, GitHub and Odoo cards
│   ├── timesheet/          Table, period pickers, action bar, dialogs
│   └── ui/                 shadcn/ui components (generated)
├── contexts/               SettingsContext (user settings, shared)
├── hooks/                  useTimesheet, useSession, useFormatters, useTaskDetails
├── services/               Supabase Auth and Edge Function calls
├── types/                  Domain types and Edge Function contracts
└── utils/                  Commit parser, periods, dates, rules, reconciliation
supabase/
├── migrations/             user_settings table
└── functions/
    ├── _shared/            Auth, HTTP, crypto, settings store, Odoo and GitHub clients
    ├── user-settings/
    ├── github-commits/
    └── odoo-gateway/
public/                     Favicon and PWA icons
```

## Scripts

| Command          | Purpose                            |
| ---------------- | ---------------------------------- |
| `pnpm dev`       | Development server with hot reload |
| `pnpm build`     | Type-check, then production build  |
| `pnpm preview`   | Serve the production build locally |
| `pnpm typecheck` | Type-check only                    |
| `pnpm lint`      | ESLint                             |
| `pnpm format`    | Prettier                           |
| `node scripts/pmoTask.ts` | Post a test note on a PMO task and approve it |

## PMO notes from the command line

`scripts/pmoTask.ts` posts a test note on a PMO task and sets the task to
_Approved_, with your own Odoo account. Claude runs it at the end of a test
session (skill `pmo-recette`), but it works by hand too. Fill `PMO_URL`,
`PMO_LOGIN`, `PMO_API_KEY` (and `PMO_DB` when the server hosts several
databases) in `.env`, then:

```bash
node scripts/pmoTask.ts show 03-500
node scripts/pmoTask.ts approve 03-500 --file note.txt --dry-run
node scripts/pmoTask.ts approve 03-500 --file note.txt
node scripts/pmoTask.ts note "#1234" --file note.txt
```

The task is a reference found in its name (`03-500`, whole token, as for
commits) or an id (`#1234`); several matches are listed and nothing is
written. The note is plain text (from `--file` or stdin) and is posted as an
internal note, like _Log note_ in the chatter, keeping its lines and
indentation. `approve` then writes `state = 03_approved` (Odoo 17+) or
`kanban_state = done` (up to 16) and reads the task back to check it.

## Troubleshooting

| Symptom                              | Check                                                                                     |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| _Pointage isn't configured_          | `.env` exists at the project root, then restart `pnpm dev`                                |
| Saving settings fails                | The notification gives the reason; details in **Edge Functions → Logs**                   |
| _Couldn't detect the database_       | Enter the Odoo database name in Settings                                                  |
| _… redirects to …_                   | Use the address given in the message as the Odoo URL                                      |
| _Stored settings can't be decrypted_ | `CREDENTIALS_ENCRYPTION_KEY` changed: save the settings again                             |
| Commits missing                      | Add your local Git email in Settings; check the token can read the repository             |
| A task is _Missing_                  | The message needs a reference such as `[03-500]`, and you need access to the task in Odoo |
| The header doesn't stay at the top   | `SidebarInset` in `src/components/ui/sidebar.tsx` must not have `overflow-hidden`         |
| Old version after a deployment       | Reload once: the service worker updates on the next visit                                 |
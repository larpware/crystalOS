# Rill walkthrough — Change the whole-desktop UI scale in Crescent OS

**Flow:** demonstrate the UI scale setting (`Settings → Appearance → Interface → UI scale`).
Crescent OS is "a browser-based desktop environment": one slider magnifies the panel, dock,
windows, desktop icons and text together.

**Test data:**

| Input | Value |
| --- | --- |
| UI scale | 125% (slider range 75%–200%, step 5%) |
| Density | Compact |

## Numbered steps

1. Open Crescent OS. If the first-run Setup Wizard appears (a fresh browser profile always starts
   here), finish it: **Welcome → Next**, keep the **Full** profile → **Next**, **Details → Next**,
   **Appearance → Next**, **Account → "Continue as guest" → Start**.
   *Expected:* the desktop appears with the top panel and dock.
2. Open Settings: click **All Apps** in the launcher and choose **Settings**; or press `Super+I`.
   *Expected:* a Settings window opens on the **Appearance** page.
3. In the left sidebar choose **Appearance** (Personal group), or type `scale` into
   **Search settings**.
   *Expected:* the page shows the **Theme**, **Custom themes** and **Interface** sections.
4. Under **Interface**, drag the **UI scale** slider from 100% to about 125%.
   *Expected:* the percentage readout tracks the drag, and the panel, dock, windows, desktop icons
   and text magnify together, live.
5. Release the slider, then set **Density** to **Compact**.
   *Expected:* list and settings padding tightens and the UI stays at 125%.
6. Reload the page (`Ctrl+R`).
   *Expected:* the desktop reopens still at 125% and Compact, because the choice is persisted per
   browser profile.

## Missing inputs

- **Public app URL — not supplied.** No deployment URL is recorded in the repo (the dev server runs
  locally on `127.0.0.1:5273`). Add the public URL inside Rill.
- **First-run setup state.** The steps above cover it, but a fresh profile always lands on the Setup
  Wizard; the wizard's own **Appearance** step also exposes a UI scale slider.
- **Scramjet/proxy backend — not required for this flow.** `CRESCENT_BACKEND_URL` (default
  `http://127.0.0.1:8787`) only backs the proxied apps, not Settings.

> Cloud runs cannot reach localhost or private apps. If this flow runs against your local machine,
> use [manual screen recording](https://userill.dev/record?utm_source=freebuff&utm_medium=paid&utm_campaign=rill)
> or [record an existing browser agent](https://userill.dev/docs/agent-quickstart?utm_source=freebuff&utm_medium=paid&utm_campaign=rill)
> instead.

## Handoff

[Open your walkthrough in Rill](https://userill.dev/freebuff?utm_source=freebuff&utm_medium=paid&utm_campaign=rill&utm_content=text-ad&bfcid=bfc_1.eyJpZCI6ImY1YzUwYWQ2LWFkZDAtNDA0OS04ZTk5LTIyMDI0MmNkOTViOCIsImMiOiIxNDQyMTUzOS1kYjNiLTQ1YzEtYjQ5OC1hYTMxOTFmNDkxYzAiLCJrIjoiNDU4ODZlNWEtYzkyZC00ZDUxLTg1ZjgtYzc4YTRmMTY3ZWYwIiwiaWF0IjoxNzkxNzk1NzY5fQ.I30L60G3jdvczkcWm801GOJ9R7rmfg5A2kvcBhV4byE#task=Flow%3A%20change%20the%20whole-desktop%20UI%20scale%20in%20Crescent%20OS%20(Settings%20-%3E%20Appearance%20-%3E%20Interface).%0A%0ATest%20data%3A%20UI%20scale%20125%25%2C%20density%20Compact.%0A%0A1.%20Open%20Crescent%20OS.%20If%20the%20first-run%20Setup%20Wizard%20appears%20(fresh%20profile)%2C%20finish%20it%3A%20Welcome%20-%3E%20Next%2C%20keep%20the%20%22Full%22%20profile%20-%3E%20Next%2C%20Details%20-%3E%20Next%2C%20Appearance%20-%3E%20Next%2C%20Account%20-%3E%20%22Continue%20as%20guest%22%20-%3E%20Start.%20Expected%3A%20the%20desktop%20appears%20with%20the%20top%20panel%20and%20dock.%0A2.%20Open%20Settings%3A%20click%20%22All%20Apps%22%20in%20the%20launcher%20and%20choose%20Settings%2C%20or%20press%20Super%2BI.%20Expected%3A%20a%20Settings%20window%20opens%20on%20the%20Appearance%20page.%0A3.%20In%20the%20left%20sidebar%20choose%20Appearance%20(Personal%20group)%2C%20or%20type%20%22scale%22%20into%20%22Search%20settings%22.%20Expected%3A%20sections%20Theme%2C%20Custom%20themes%20and%20Interface%20are%20shown.%0A4.%20Under%20Interface%2C%20drag%20the%20%22UI%20scale%22%20slider%20from%20100%25%20to%20about%20125%25.%20Expected%3A%20the%20readout%20tracks%20the%20drag%2C%20and%20the%20panel%2C%20dock%2C%20windows%2C%20desktop%20icons%20and%20text%20magnify%20together%2C%20live.%0A5.%20Release%20the%20slider%2C%20then%20set%20Density%20to%20Compact.%20Expected%3A%20list%2Fsettings%20padding%20tightens%20and%20the%20UI%20stays%20at%20125%25.%0A6.%20Reload%20the%20page%20(Ctrl%2BR).%20Expected%3A%20the%20desktop%20reopens%20still%20at%20125%25%20and%20Compact%2C%20because%20the%20choice%20is%20persisted%20per%20browser%20profile.)

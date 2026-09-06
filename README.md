# Offstage

A private dossier for the character you're roleplaying with, inside SillyTavern.

Offstage keeps a separate file per character: personality split into what's public, what's
private, and what they'd never admit; their tastes and comforts; and an inbox of things the
model noticed that you haven't approved yet. Nothing the model proposes touches the dossier
until you say so.

## Install

In SillyTavern: **Extensions → Install Extension**, then paste

```
https://github.com/howardsierra/SillyTavern-Offstage
```

Open it from the floating **✦ Offstage** button, the extensions menu, or the Offstage card
under Extensions.

## What it does

**Dossier.** Mood, current state, and energy sit in the header and can change often. Traits and
favourites are durable and are edited deliberately.

**Provenance on everything.** Each fact records where it came from, and the colour of the rule
on its left tells you at a glance:

| Provenance | Means |
| --- | --- |
| canon | Stated on the character card |
| established | Stated in the roleplay |
| inferred | Repeated behaviour, not stated |
| emergent | Developed during this roleplay |
| headcanon | Your call, or the model's, clearly labelled |

**Automatic analysis.** Every few character replies, Offstage reads recent messages plus the
card and proposes durable details. Mood, status, and energy update on their own if you let
them; everything else waits in Discoveries. Uses the Connection Manager profile you have
selected for roleplay — its model, preset, API, and instruct settings — falling back to
SillyTavern's active connection. It costs tokens.

**AI Fill.** When you want to build a character out rather than wait, use *Suggest traits*,
*Suggest a favourite*, or *Suggest a starting profile*. Suggestions appear in an editable
preview where you can change or deselect them, then go to Discoveries. Turning on
*Allow headcanon* lets the model make a plausible choice when the card and roleplay don't
answer the question; those are labelled `headcanon`, never canon.

**Discoveries.** Accept, keep hidden, edit, or reject. Accepting respects the proposed
visibility. Keeping it hidden files it under hidden traits, or as an undiscovered favourite you
can reveal later. Duplicates are skipped rather than stacked.

**Journal.** Diary entries, letters they never sent, notes to themselves, dreams. Write one
yourself, or use *Write about this scene* and the model drafts one in their voice, first person,
about the roleplay you just played. Entries can be sealed and revealed later.

Offstage also writes one on its own when something actually happens. The analyzer already reads
the transcript on its regular scan, so it now also scores how much changed — a confession, a
betrayal, a death, a decision that can't be taken back, or a clear shift in how they feel about
someone. Only when that score crosses the threshold does it spend a second call writing the
entry. Nothing is written on a timer, and nothing is written twice inside eight replies.

**Social.** Four accounts: the public one, the private one, close friends, and drafts they never
posted. Posts carry likes and replies, and you can add a reply yourself. Handles are set once
under *Accounts*. Drafts are marked as never sent. If the character's world has no social media,
the model is told to say so rather than invent one.

Posts are drafted automatically every few replies, because posting is a habit rather than a
reaction to anything. The cadence is yours to set, and drafting pauses once a few unreviewed
posts are queued up so the inbox can't run away from you.

**Music.** Playlists with tracks, each track carrying a line about what the song means to them.
Proposals name their own playlist and create it on approval if it doesn't exist yet. In settings
without recorded music, the model proposes in-world songs, ballads, or hymns instead.

**Themes.** Rosewater, Paper, Foxglove, Midnight, Velvet, and Noir, stored per character.

## Not supported yet

Group chats. Offstage keeps one dossier per character and doesn't try to guess who a message
belongs to in a group, so it stays out of the way there.

## Files

| File | Role |
| --- | --- |
| `index.js` | Entry point. Creates the launcher and menu item, wires the modules. |
| `core.js` | Settings, profile schema and migration, character lookup, prompt context, event bus. |
| `llm.js` | Connection-profile resolution, generation, JSON recovery. |
| `ui.js` | Panel markup, tabs, and every event inside the drawer. |
| `life.js` | Journal, Social, and Music pages and their controls. |
| `modal.js` | The shared editing modal. |
| `approvals.js` | The Discovery Inbox. The only code that writes a proposal into a dossier. |
| `analyzer.js` | Automatic and manual analysis. |
| `aifill.js` | The AI Fill sheet. |
| `writing.js` | Prompts and normalising, shared by AI Fill and automatic writing. |
| `settings.js` | The card under Extensions. |
| `style.css` | Design tokens, six themes, all components. |

## 0.8.0

Journal and social entries can now be written without being asked for.

Journal entries fire on significance rather than on a schedule. The analyzer's existing scan now
returns an `event` reading — how much changed, whether it was a plot event or a relationship
shift, and one sentence naming it — and a journal entry is written only when that crosses the
threshold you set. It costs nothing on a quiet scan.

Social posts run on their own interval, defaulting to every five replies. Both stop generating
once a couple of unapproved pieces are already waiting, so an inbox you haven't triaged doesn't
keep growing, and both write into Discoveries like everything else.

`writing.js` is new. The prompts, the voice rules, and the normalising were living inside the AI
Fill sheet; the analyzer needed the same ones, so they moved somewhere both can reach rather than
being duplicated.

## 0.7.0

Journal, Social, and Music are built.

Each works both ways: write entries by hand, or ask the model for them. Model suggestions go
through the same preview-then-approve path as traits and favourites, so nothing lands in a
dossier without you accepting it. Journal and social proposals are written in first person in
the character's voice rather than described from outside, and both are told to stay inside the
character's world — a character with no paper or no internet gets an explanation, not an
anachronism.

The dossier schema gained `handles` for the social accounts, and journal, social, and playlist
entries are normalised on load, so profiles saved by 0.6 open without losing anything.

`modal.js` is new: the shared modal moved out of `ui.js` so the new pages could use it without
a circular import.

## 0.6.0

A rewrite of the internals. Existing dossiers are read and migrated in place; nothing needs
re-entering.

Removed `entry.js`, `bootstrap.js`, `analyzer-profile.js`, `ai-fill.js`, `approval-bridge.js`,
and `drawer.css`, plus `analyzer.js` in its old form, which was dead code — it had been
superseded by `analyzer-profile.js` and was no longer imported anywhere.

Fixed:

- The close button did nothing when no character was open.
- Accepting a proposal always filed it as a hidden trait and stripped words from its title.
- Three capture-phase listeners were competing for the same discovery buttons; all approval
  logic now lives in one place.
- Two `MutationObserver`s were watching the whole document and writing to the DOM on every
  change in the chat. Both are gone; buttons are rendered where they belong.
- The panel initialised twice, registering duplicate SillyTavern event listeners.
- Every action re-rendered the panel and threw you back to the top. Scroll position is kept.
- Character names were interpolated into HTML unescaped in the fallback view.
- Analysis history grew without limit inside `settings.json`.
- Editing a proposal used browser `prompt()` dialogs; it now uses the in-app modal.

Also new: Escape closes the panel, tabs are a real tab list, keyboard focus is visible
throughout, hidden favourites have a Reveal action, and malformed JSON from smaller models is
retried before it's treated as a failure.

Styling is one file now. `style.css` was previously loaded twice, overridden by `drawer.css`
with `!important` on nearly every rule, then overridden again by a third stylesheet injected
from `bootstrap.js`. Themes were declared in two places. There are no `!important` declarations
left, and each theme is a block of tokens near the top of the file.

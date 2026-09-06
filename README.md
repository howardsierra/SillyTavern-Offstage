# Offstage for SillyTavern

A living-character dashboard for SillyTavern.

## v0.5 prototype

Working foundation:
- Current-character detection
- Per-character persistent extension data
- Responsive luxury side-drawer UI
- Native Offstage card in SillyTavern's Extensions settings
- Rosewater, Midnight, Paper, and Velvet themes
- Profile dashboard
- Public / Private / Hidden personality traits
- Favorites with hidden/discovery support
- Discovery Inbox approval flow
- Automatic AI character analysis
- Manual **Analyze current context now** control
- Automatic transient Mood / Currently / Energy updates
- AI-proposed personality traits and favorites routed to the Discovery Inbox
- **AI Add** for Personality and Favorites
- **AI Build** for a balanced mini-profile
- AI Fill preview/edit/select flow
- Mandatory Discovery Inbox approval before AI Fill suggestions become profile data
- Active RP Connection Manager profile reuse for analysis and AI Fill
- Placeholders for Journal, Social, and Music

## Automatic AI analysis behavior

Offstage uses the currently selected SillyTavern Connection Manager profile when one is active, including that profile's provider/model connection. If no Connection Manager profile is selected, it falls back to SillyTavern's active connection. This consumes model/API tokens.

By default it:
- scans after every 5 character replies;
- sends recent non-system messages plus relevant character-card context;
- updates transient Mood / Currently / Energy automatically;
- queues durable traits and favorites for approval instead of silently making them canon;
- avoids duplicate discoveries already present in the character's Offstage profile;
- asks the model to stay setting-aware and avoid inventing unsupported modern preferences in fantasy/historical settings.

You can change the scan interval and context-window size, disable automatic analysis, or run a scan manually from the **Offstage** card under Extensions.

## Manual AI Fill

Manual AI Fill is intentionally less restrictive than automatic analysis because the user explicitly asks the model to help build the character.

- **Personality → AI Add** can suggest Public, Private, or Hidden traits.
- **Favorites → AI Add** can fill a requested category such as Food, Drink, Color, Scent, Book/Story, Art/Entertainment, Music, Place, Guilty Pleasure, and more.
- **Profile → AI Build** can propose a balanced mini-profile across traits and favorites.
- The model reads the character card, recent RP, and existing Offstage state before deciding.
- **Allow logical headcanon** lets the model make a plausible character-specific choice when canon/context does not explicitly answer the question. These choices are labeled `headcanon`, not canon.
- Suggestions first appear in an editable preview where they can be changed, unchecked, or regenerated.
- Choosing **Send selected to Discovery Inbox** does **not** add them to the character profile.
- Every AI Fill suggestion must then be explicitly **Accepted**, **Kept Hidden**, or **Rejected** in the Discovery Inbox before it can alter Personality or Favorites.
- AI Fill will not overwrite duplicate accepted facts.

## Install for testing

In SillyTavern, use **Extensions → Install Extension** and paste:

`https://github.com/howardsierra/SillyTavern-Offstage`

## Current test checklist

1. Open a single-character chat.
2. Open **Extensions → Offstage** and confirm the current character and RP connection profile are detected.
3. Tap **Analyze current context now** and confirm automatic analysis works.
4. Open Offstage → **Personality** and try **AI Add**.
5. Open Offstage → **Favorites**, type a category such as `Food`, and try **AI Add**.
6. Try **AI Build** from the Profile page.
7. Edit/uncheck suggestions, then send selected suggestions to the Discovery Inbox.
8. Verify nothing has been added to Personality/Favorites yet.
9. Accept, Keep Hidden, or Reject each queued AI Fill suggestion and confirm only approved details become profile data.
10. Switch characters and confirm each character keeps a separate profile.

Group-chat analysis is not enabled yet.

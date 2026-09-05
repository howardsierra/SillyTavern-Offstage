# Offstage for SillyTavern

A living-character dashboard for SillyTavern.

## v0.4 prototype

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
- Placeholders for Journal, Social, and Music

## AI analysis behavior

Offstage uses the model/API currently selected in SillyTavern. This consumes model/API tokens.

By default it:
- scans after every 5 character replies;
- sends up to 24 recent non-system messages plus relevant character-card context;
- updates transient Mood / Currently / Energy automatically;
- queues durable traits and favorites for approval instead of silently making them canon;
- avoids duplicate discoveries already present in the character's Offstage profile;
- asks the model to stay setting-aware and avoid inventing unsupported modern preferences in fantasy/historical settings.

You can change the scan interval and context-window size, disable automatic analysis, or run a scan manually from the **Offstage** card under Extensions.

## Install for testing

In SillyTavern, use **Extensions → Install Extension** and paste:

`https://github.com/howardsierra/SillyTavern-Offstage`

## Current test checklist

1. Open a single-character chat.
2. Open **Extensions → Offstage** and confirm the current character is detected.
3. Tap **Analyze current context now**.
4. Confirm Mood / Currently / Energy can update from the scan.
5. Open Offstage's Discovery Inbox and review any proposed traits/favorites.
6. Test Accept, Keep Hidden, Edit, and Reject.
7. Continue chatting for the configured number of character replies and confirm an automatic scan runs.
8. Close/reopen Offstage and verify the character profile persists.
9. Switch characters and confirm each character keeps a separate profile.

Group-chat analysis is not enabled yet.

# Offstage for SillyTavern

A living-character dashboard for SillyTavern.

## v0.1 prototype

Working foundation:
- Current-character detection
- Per-character persistent extension data
- Full-screen responsive UI
- Rosewater, Midnight, Paper, and Velvet themes
- Profile dashboard
- Public / Private / Hidden personality traits
- Favorites with hidden/discovery support
- Discovery Inbox approval flow
- Placeholders for Journal, Social, and Music

The AI roleplay analyzer is intentionally not connected yet. First validate that the UI loads, saves data, and switches characters correctly.

## Install for testing

In SillyTavern, use **Extensions → Install Extension** and paste:

`https://github.com/howardsierra/SillyTavern-Offstage`

## Test checklist

1. Open a single-character chat.
2. Click the **Offstage** floating button.
3. Change the tagline/mood/current state/energy.
4. Add one Public, one Private, and one Hidden trait.
5. Add a normal favorite and a hidden favorite.
6. Add the test discovery, then Accept or Keep Hidden.
7. Close and reopen Offstage; data should remain.
8. Switch to another character; that character should have a separate blank profile.
9. Switch back; the first character's profile should still be there.
10. Redeploy/restart SillyTavern and verify the data remains.

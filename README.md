# Offstage for SillyTavern

A living-character dashboard for SillyTavern.

## v0.2 drawer prototype

Working foundation:
- Persistent **✦ Offstage** pill launcher
- Soft, glassy, luxury right-side overlay drawer on desktop/tablet
- Full-screen mobile layout with an always-visible **Close** control
- Mobile starts closed
- Current-character detection
- Per-character persistent extension data
- Rosewater, Midnight, Paper, and Velvet themes
- Profile dashboard
- Public / Private / Hidden personality traits
- Favorites with hidden/discovery support
- Discovery Inbox approval flow
- Placeholders for Journal, Social, and Music

The AI roleplay analyzer is intentionally not connected yet. First validate that the UI loads, saves data, switches characters correctly, and feels right in the new drawer layout.

## Install for testing

In SillyTavern, use **Extensions → Install Extension** and paste:

`https://github.com/howardsierra/SillyTavern-Offstage`

If it is already installed, use **Manage Extensions → Update** and then refresh SillyTavern.

## Test checklist

1. Open a single-character chat.
2. Tap the persistent **✦ Offstage** pill or the Offstage item in the Extensions menu.
3. Verify the interface slides over the right side of the chat rather than appearing as a centered popup.
4. On mobile, verify it opens full-screen and the **Close** control remains easy to reach.
5. Change the tagline/mood/current state/energy.
6. Add one Public, one Private, and one Hidden trait.
7. Add a normal favorite and a hidden favorite.
8. Add the test discovery, then Accept or Keep Hidden.
9. Close and reopen Offstage; data should remain.
10. Switch to another character; that character should have a separate blank profile.

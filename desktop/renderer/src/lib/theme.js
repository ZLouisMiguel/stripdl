// desktop/renderer/src/lib/theme.js
//
// Ported unchanged from the old app.js applyTheme(). Kept as a standalone
// function (not a hook) since it's called both from a one-time effect in
// App.jsx and from an event handler in Sidebar.jsx.

export function applyTheme(theme) {
  if (theme === "dark") {
    document.body.setAttribute("data-theme", "dark");
  } else if (theme === "light") {
    document.body.setAttribute("data-theme", "light");
  } else {
    document.body.setAttribute(
      "data-theme",
      window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light",
    );
  }
}

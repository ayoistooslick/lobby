// Applies the saved theme before the first paint, so the page never flashes
// white on a dark phone. Kept in its own file so a strict Content Security
// Policy can stay at `script-src 'self'` with no inline script at all.
(function () {
  try {
    var saved = localStorage.getItem("lobby.theme");
    var dark = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  } catch (error) {
    document.documentElement.dataset.theme = "light";
  }
})();
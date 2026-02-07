(function () {
  function selectTabFromHash() {
    const hash = (location.hash || "#friday").replace("#", "");
    const wanted = (hash === "friday" || hash === "saturday" || hash === "sunday") ? hash : "friday";

    document.querySelectorAll(".tabs a").forEach(a => {
      const tab = a.getAttribute("data-tab");
      if (tab === wanted) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });

    document.querySelectorAll("section.day").forEach(sec => {
      // Only hide the main Fri/Sat/Sun sections via id match; keep “Other days” visible.
      if (sec.id === "friday" || sec.id === "saturday" || sec.id === "sunday") {
        sec.style.display = (sec.id === wanted) ? "" : "none";
      }
    });
  }

  function updatePastEvents() {
    const now = Date.now();
    const events = Array.from(document.querySelectorAll(".event"));

    let nextBoundary = Infinity;

    for (const el of events) {
      const endMs = Number(el.getAttribute("data-end-ms") || "0");
      if (endMs > 0 && endMs <= now) el.classList.add("past");
      else el.classList.remove("past");

      if (endMs > now && endMs < nextBoundary) nextBoundary = endMs;
    }

    // Schedule a precise update at the next end time so it flips “instantly”.
    if (Number.isFinite(nextBoundary)) {
      const delay = Math.max(0, nextBoundary - Date.now() + 75);
      clearTimeout(updatePastEvents._t);
      updatePastEvents._t = setTimeout(updatePastEvents, delay);
    }
  }
  updatePastEvents._t = null;

  // Tabs
  window.addEventListener("hashchange", selectTabFromHash);
  selectTabFromHash();

  // Grey-out updates: interval fallback + boundary timeout
  updatePastEvents();
  setInterval(updatePastEvents, 15000);
})();

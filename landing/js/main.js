(function () {
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("site-nav");
  var header = document.querySelector(".site-header");
  var desktop = window.matchMedia("(min-width: 980px)");

  function syncNav() {
    if (!nav || !toggle) return;
    var open = toggle.getAttribute("aria-expanded") === "true";
    if (desktop.matches || open) {
      nav.removeAttribute("aria-hidden");
    } else {
      nav.setAttribute("aria-hidden", "true");
    }
  }

  function setOpen(open) {
    if (!nav || !toggle) return;
    nav.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    document.body.classList.toggle("nav-open", open);
    syncNav();
  }

  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = toggle.getAttribute("aria-expanded") !== "true";
      setOpen(open);
      if (open) {
        var first = nav.querySelector("a");
        if (first) first.focus();
      }
    });

    nav.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        if (!desktop.matches) {
          setOpen(false);
          toggle.focus();
        }
      });
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
        setOpen(false);
        toggle.focus();
      }
    });

    if (typeof desktop.addEventListener === "function") {
      desktop.addEventListener("change", function () {
        if (desktop.matches) setOpen(false);
        syncNav();
      });
    }

    syncNav();
  }

  if (header) {
    var onScroll = function () {
      header.classList.toggle("is-scrolled", window.scrollY > 6);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }
})();

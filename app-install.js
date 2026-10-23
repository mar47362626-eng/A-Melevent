"use strict";

let installPrompt = null;
const installButtons = document.querySelectorAll(".app-install-button");
const iosInstallAvailable = /iphone|ipad|ipod/i.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = window.matchMedia("(display-mode: standalone)").matches
  || navigator.standalone === true;

function setInstallAvailability(isAvailable) {
  installButtons.forEach((button) => {
    button.hidden = !isAvailable;
  });
}

if (isStandalone) {
  setInstallAvailability(false);
} else if (iosInstallAvailable) {
  setInstallAvailability(true);
} else {
  setInstallAvailability(false);
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  setInstallAvailability(true);
});

window.addEventListener("appinstalled", () => {
  installPrompt = null;
  setInstallAvailability(false);
});

installButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const help = button.closest(".app-install-control")?.querySelector(".app-install-help");
    if (iosInstallAvailable) {
      if (help) help.hidden = !help.hidden;
      button.setAttribute("aria-expanded", String(help ? !help.hidden : false));
      return;
    }

    if (!installPrompt) return;

    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    installPrompt = null;
    if (outcome === "accepted") setInstallAvailability(false);
  });
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch((error) => {
      console.error("Could not register the A&M app service worker:", error);
    });
  });
}

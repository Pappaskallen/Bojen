/* global customElements, document, location, HTMLElement, window */
/*
 * Bojen booking widget (W1). One line on the mechanic's site:
 *
 *   <script src="https://boka.bojen.se/widget.js" defer></script>
 *   <bojen-boka firma="jonas-batservice"></bojen-boka>
 *
 * Optional attributes: marina="bullando-marina" (place chosen already) and tjanst="<id>".
 * The booking page runs in an iframe and tells the widget how tall it is.
 */
(function () {
  if (customElements.get("bojen-boka")) return;
  var script = document.currentScript;
  var origin = script ? new URL(script.src).origin : location.origin;

  class BojenBoka extends HTMLElement {
    connectedCallback() {
      if (this.frame) return;
      var firm = this.getAttribute("firma");
      if (!firm || !/^[a-z0-9-]+$/.test(firm)) return;
      var marina = this.getAttribute("marina");
      var service = this.getAttribute("tjanst");
      var path = "/boka/" + firm + (marina && /^[a-z0-9-]+$/.test(marina) ? "/m/" + marina : "");
      var query = new URLSearchParams({ embed: "1" });
      if (service) query.set("tjanst", service);

      var frame = document.createElement("iframe");
      frame.src = origin + path + "?" + query.toString();
      frame.title = "Boka tid";
      frame.style.cssText = "width:100%;border:0;min-height:520px;display:block";
      this.frame = frame;
      this.appendChild(frame);

      this.onMessage = function (event) {
        if (event.origin !== origin || event.source !== frame.contentWindow) return;
        var data = event.data;
        if (data && data.type === "bojen:height" && typeof data.height === "number") {
          frame.style.height = Math.min(Math.max(data.height, 320), 4000) + "px";
        }
      };
      window.addEventListener("message", this.onMessage);
    }

    disconnectedCallback() {
      if (this.onMessage) window.removeEventListener("message", this.onMessage);
    }
  }

  customElements.define("bojen-boka", BojenBoka);
})();

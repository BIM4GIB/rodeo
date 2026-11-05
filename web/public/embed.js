// Rodeo's embed script. A page loads it once with <script async src="…/embed.js"></script>.
// It defines <rodeo-viewer>, which shows a shared drawing (share="…") or a public file (src="…")
// in a frame on Rodeo, and window.RodeoEmbed, the address and poster builders the Share dialog's
// codes use. It is plain JavaScript with no build step, so it runs on any page, and it must stay
// in step with features/embed/options.ts (the option keys and how they are encoded).

(function () {
  "use strict";

  // The server this copy was served from, so a self-hosted Rodeo's embed.js points at itself.
  var ORIGIN = document.currentScript && document.currentScript.src
    ? new URL(document.currentScript.src).origin
    : "https://rodeo.build";

  // The viewer's options, in the order their addresses list them.
  var OPTION_KEYS = ["view", "layer", "at", "cam", "preset", "render", "rotate", "theme", "ui"];

  var RATIO = /^\d+(\.\d+)?\s*\/\s*\d+(\.\d+)?$/;
  var HEIGHT = /^\d+$/;

  // The host and the click-to-load picture: a grey frame that the drawing fills.
  var STYLE =
    ":host{display:block;position:relative;width:100%;aspect-ratio:16/9;background:#e6e7ea;border-radius:8px;overflow:hidden}" +
    ":host([hidden]){display:none}" +
    "iframe{position:absolute;inset:0;width:100%;height:100%;border:0}" +
    ".facade{position:absolute;inset:0;width:100%;height:100%;padding:0;border:0;background:#e6e7ea;cursor:pointer}" +
    ".facade img{display:block;width:100%;height:100%;object-fit:contain}" +
    ".play{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);padding:10px 16px;border-radius:999px;background:#1d1d1d;color:#fff;font:600 14px system-ui,sans-serif}";

  // A non-empty string: an attribute that is there and says something.
  function has(value) {
    return typeof value === "string" && value.length > 0;
  }

  // Encodes an option value the way the address contract does, keeping commas readable.
  function enc(value) {
    return encodeURIComponent(value).replace(/%2C/gi, ",");
  }

  // A share attribute is a bare token, or the address of a share link on any Rodeo server.
  // Returns the link's origin (null for a bare token) and its token, or null if it doesn't parse.
  function shareOf(share) {
    if (share.indexOf("://") < 0) return { origin: null, token: share };
    try {
      var url = new URL(share);
      return { origin: url.origin, token: url.searchParams.get("share") || url.searchParams.get("embed") || "" };
    } catch (e) {
      return null;
    }
  }

  // The address of the viewer for the attributes (name to value, null when absent), or null
  // when they name nothing to show.
  function viewerUrl(origin, attrs) {
    var url;
    if (has(attrs.share)) {
      var target = shareOf(attrs.share);
      if (!target || !target.token) return null;
      url = (target.origin || origin) + "/?embed=" + enc(target.token);
    } else if (has(attrs.src)) {
      url = origin + "/?embed&url=" + encodeURIComponent(attrs.src);
    } else {
      return null;
    }
    for (var i = 0; i < OPTION_KEYS.length; i++) {
      var key = OPTION_KEYS[i];
      var value = attrs[key];
      if (key === "rotate") {
        // being there turns it on; "false" and "0" leave it off
        if (value !== null && value !== undefined && value !== "false" && value !== "0") url += "&rotate=1";
      } else if (has(value)) {
        url += "&" + key + "=" + enc(value);
      }
    }
    return url;
  }

  // The address of a share link's poster picture. It is public, so it needs no sign-in.
  function posterUrl(origin, token) {
    return origin + "/api/s/" + enc(token) + "/poster";
  }

  // The attributes the viewer address is built from, by name, null where the element has none.
  function attributesOf(el) {
    var attrs = {};
    var names = ["share", "src"].concat(OPTION_KEYS);
    for (var i = 0; i < names.length; i++) attrs[names[i]] = el.getAttribute(names[i]);
    return attrs;
  }

  // The iframe that shows the viewer, allowed full screen. `loading` is "lazy", or null for none.
  function frameFor(url, title, loading) {
    var frame = document.createElement("iframe");
    frame.src = url;
    frame.title = title;
    frame.setAttribute("allow", "fullscreen");
    frame.setAttribute("allowfullscreen", "");
    if (loading) frame.setAttribute("loading", loading);
    return frame;
  }

  window.RodeoEmbed = { version: 1, viewerUrl: viewerUrl, posterUrl: posterUrl };

  // <rodeo-viewer share="…" view="3d">: a frame that shows the drawing, sized by its own
  // attributes. load="lazy" (the default), "eager", or "click" (a picture until it is clicked).
  class RodeoViewer extends HTMLElement {
    static get observedAttributes() {
      return ["share", "src", "ratio", "height", "load", "title"].concat(OPTION_KEYS);
    }

    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this.frame = null; // the iframe, once there is one
      this.viewerOrigin = null; // the origin the viewer's messages come from
      this.onMessage = (event) => this.relay(event);
    }

    connectedCallback() {
      window.addEventListener("message", this.onMessage);
      this.render();
    }

    disconnectedCallback() {
      window.removeEventListener("message", this.onMessage);
    }

    attributeChangedCallback() {
      if (this.isConnected) this.render();
    }

    // Rebuilds the shadow root from the attributes: the style, then the frame or the picture.
    render() {
      var root = this.shadowRoot;
      while (root.firstChild) root.removeChild(root.firstChild);
      var style = document.createElement("style");
      style.textContent = STYLE;
      root.appendChild(style);
      this.frame = null;
      this.viewerOrigin = null;
      this.size();

      var attrs = attributesOf(this);
      var url = viewerUrl(ORIGIN, attrs);
      if (!url) return;
      this.viewerOrigin = new URL(url).origin;
      var title = this.getAttribute("title") || "Drawing on Rodeo";
      var load = this.getAttribute("load");

      // a click-to-load picture is only for a share link: a public file has no poster on Rodeo
      if (load === "click" && has(attrs.share)) {
        var target = shareOf(attrs.share);
        root.appendChild(this.facade(posterUrl(target.origin || ORIGIN, target.token), url, title));
      } else {
        this.frame = frameFor(url, title, load === "eager" ? null : "lazy");
        root.appendChild(this.frame);
      }
    }

    // Sizes the host: a ratio such as "4/3", or a height in pixels, which wins; else the stylesheet's 16:9.
    size() {
      var ratio = this.getAttribute("ratio");
      var height = this.getAttribute("height");
      this.style.aspectRatio = "";
      this.style.height = "";
      if (ratio !== null && RATIO.test(ratio)) this.style.aspectRatio = ratio;
      if (height !== null && HEIGHT.test(height)) {
        this.style.height = height + "px";
        this.style.aspectRatio = "auto";
      }
    }

    // The click-to-load picture: the drawing's poster and a button; a click puts the frame in its place.
    facade(poster, url, title) {
      var button = document.createElement("button");
      button.className = "facade";
      button.type = "button";
      button.setAttribute("aria-label", "View the drawing");
      var img = document.createElement("img");
      img.alt = "";
      img.setAttribute("loading", "lazy");
      img.src = poster;
      var play = document.createElement("span");
      play.className = "play";
      play.textContent = "View drawing";
      button.append(img, play);
      button.addEventListener("click", () => {
        var frame = frameFor(url, title, null);
        button.replaceWith(frame);
        this.frame = frame;
        frame.focus();
      });
      return button;
    }

    // Turns a message from the viewer into a DOM event on the element (rodeo-ready, rodeo-view,
    // rodeo-selection, rodeo-error). Only the viewer's own frame and origin count.
    relay(event) {
      var frame = this.frame;
      if (!frame || !frame.contentWindow || event.source !== frame.contentWindow) return;
      if (event.origin !== this.viewerOrigin) return;
      var data = event.data;
      if (!data || data.rodeo !== 1 || typeof data.type !== "string") return;
      this.dispatchEvent(new CustomEvent("rodeo-" + data.type, { detail: data, bubbles: true, composed: true }));
    }

    // Posts a message to the viewer's frame, addressed to its origin only. Does nothing before there is a frame.
    post(message) {
      var frame = this.frame;
      if (!frame || !frame.contentWindow) return;
      frame.contentWindow.postMessage(message, this.viewerOrigin);
    }

    // Shows the drawing in "2d" or "3d"; a preset (top, front, iso and so on) picks the 3D view.
    setView(view, preset) {
      var message = { rodeo: 1, type: "setView", view: view };
      if (preset) message.preset = preset;
      this.post(message);
    }

    // Fits the drawing to the frame.
    fit() {
      this.post({ rodeo: 1, type: "fit" });
    }

    // Starts (on) or stops the slow turn of the 3D view.
    rotate(on) {
      this.post({ rodeo: 1, type: "rotate", on: Boolean(on) });
    }

    // Shows a layer or sheet, named by its id, its name, its sheet number or its title.
    showLayer(layer) {
      this.post({ rodeo: 1, type: "layer", layer: layer });
    }
  }

  // Defined once per page, so a second copy of this script leaves the first element alone.
  if (!customElements.get("rodeo-viewer")) customElements.define("rodeo-viewer", RodeoViewer);
})();

// embed feature: registers itself with app/ext.ts when imported. ?embed=<token> (a share link's
// drawing) and ?embed&url=<address> (a public file) show a drawing on its own, as a viewer other
// sites frame (viewer.ts); ?url=<address> opens a public file in the editor (fromUrl.ts). The Share
// dialog's Embed section is panel.ts; the link previews and oEmbed are server/src/embed.ts. The
// start hub's footer has an Embed link to the guide's section on it.

import { h } from "../../app/dom.ts";
import { registerUrlHandler, registerWelcome } from "../../app/ext.ts";
import { openFromLink } from "./fromUrl.ts";
import { prepareEmbedPage, startEmbed } from "./viewer.ts";

const params = new URLSearchParams(location.search);
// before the editor's first paint, so nothing of the editor shows in a frame
if (params.has("embed")) prepareEmbedPage(params);

registerUrlHandler("embed", (token, p, ctx) => {
  void startEmbed(token, p, ctx);
});

registerUrlHandler("url", (address, p, ctx) => {
  // a public file in an embed is the viewer's (startEmbed), so only the editor's case is here
  if (!p.has("embed")) void openFromLink(address, ctx);
});

/** The guide's section on share links, embeds and opening a file from its address. */
const EMBED_GUIDE = "https://github.com/rodeobuild/rodeo/blob/main/docs/guide/files.md#sharing-and-embedding";

registerWelcome(
  () =>
    h("a", {
      cls: "hub-link",
      text: "Embed",
      attrs: {
        href: EMBED_GUIDE,
        target: "_blank",
        rel: "noopener",
        title: "Show a drawing on a web page, in Notion or in a README",
      },
    }),
  "foot",
);

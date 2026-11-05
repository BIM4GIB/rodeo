// embed feature: registers itself with app/ext.ts when imported. ?embed=<token> (a share link's
// drawing) and ?embed&url=<address> (a public file) show a drawing on its own, as a viewer other
// sites frame (viewer.ts); ?url=<address> opens a public file in the editor (fromUrl.ts). The Share
// dialog's Embed section is panel.ts; the link previews and oEmbed are server/src/embed.ts.

import { registerUrlHandler } from "../../app/ext.ts";
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

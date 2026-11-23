import type { PluginClientContext } from "@getpaseo/plugin/client";
import { setPlayAudio } from "./client/a2ui/audio";
import { A2uiSurfaceItem } from "./client/a2ui/surface";
import { A2UI_TIMELINE_KIND, A2UI_TIMELINE_VERSION, A2uiSurfaceDataSchema } from "./shared/contracts";

export default function contribute(client: PluginClientContext) {
  // Paseo's audio API lives on the client context; capture it for the timeline renderer.
  setPlayAudio((source) => client.playAudio(source));

  client.addTimelineRenderer({
    kind: A2UI_TIMELINE_KIND,
    version: A2UI_TIMELINE_VERSION,
    schema: A2uiSurfaceDataSchema,
    Component: A2uiSurfaceItem,
  });

  return () => {};
}

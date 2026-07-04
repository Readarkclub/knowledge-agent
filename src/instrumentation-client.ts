import { initBotId } from "botid/client/core";

initBotId({
  protect: [
    {
      path: "/api/chat",
      method: "POST",
      advancedOptions: { checkLevel: "basic" },
    },
    {
      path: "/api/search",
      method: "POST",
      advancedOptions: { checkLevel: "basic" },
    },
  ],
});

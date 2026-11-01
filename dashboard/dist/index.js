(function() {
  var SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK) return;
  var h = SDK.React.createElement;
  function AgentOffice() {
    return h("iframe", {
      src: "/dashboard-plugins/agent-office/spa/index.html",
      style: { width: "100%", height: "100%", border: "none" }
    });
  }
  window.__HERMES_PLUGINS__.register("agent-office", AgentOffice);
})();

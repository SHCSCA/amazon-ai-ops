# Stitch Availability

## Current Conclusion

`C:\Users\wz\.codex\config.toml` contains a configured Stitch MCP server entry:

- `[mcp_servers.stitch]`
- `url = "https://stitch.googleapis.com/mcp"`
- `X-Goog-Api-Key` under `[mcp_servers.stitch.http_headers]`

However, this Codex session does not expose a callable Stitch tool through tool discovery. The available callable design tools in this session are Figma-related, not Stitch.

## Design Claim Boundary

Do not claim that Stitch has generated Amazon AI Ops designs, screenshots, or artifacts until a callable Stitch MCP tool is actually exposed and returns a successful response.

For the current Task 0/1 implementation, the local design source of truth is:

- `docs/design/amazon-ai-ops-business-ui-brief.md`
- `docs/design/amazon-ai-ops-screen-map.md`

## Follow-Up When Stitch Becomes Callable

If Stitch tools appear after Codex restart or MCP reload, use this prompt to generate the design reference:

```text
Design an operational desktop admin console for Amazon AI Ops. It is not a landing page. Use a restrained, dense but clear B2B dashboard style. Screens: dashboard, data collection, ad quantification, recommendations, approval, execution readback, keyword opportunities, listing optimization, settings, delivery evidence. Currency USD. Keep technical diagnostics collapsed. Every screen must show current operational scope and next action.
```

Save any returned references, screenshots, or artifact notes under `docs/design/stitch/`, and keep this availability note updated with the date, tool name, and result.

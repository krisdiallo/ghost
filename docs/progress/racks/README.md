# Rack top rendering

The highest row of boxes is exposed, with no cap, shelf, or horizontal frame above it. The former solid cap shared the boxes' top plane at y=8.05 and caused striped patches as the overlapping faces competed in the depth buffer. All four stock levels and the existing collision envelope are preserved.

Actual Chromium/WebGL captures from the local production build, using the same camera actions before and after the change:

![Fixed racks from an angled view](after-angled.jpg)

![Fixed racks from above](after-top.jpg)

[Before the geometry fix](before-angled.jpg). The fixed scene was also checked while orbiting and panning, without browser errors. Type checks, production builds, and the repository test suite validate the change; hosted deployment is verified separately.

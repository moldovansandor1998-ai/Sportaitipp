# Customer studio redesign

## Scope

Reference-inspired violet/cyan dark visual design on the public landing page and customer workspace. The original owner dashboard and theme remain unchanged. Shared generation screens retain the owner's original status markup. No database schema, account, model, credit balance, provider submission, or billing policy is modified.

## Progress contract

The job adapters report running/done/failed, not a measured render percentage. Normal progress therefore uses a visibly labelled coarse time/stage estimate. Saved motion-sequence parts use the existing persisted parts/segments count. Neither source can show 100% until the persisted job status is completed. Failed, cancelled, refunded and uncertain jobs show status without a percent. After 45 seconds without a successful poll, the estimate disappears and a waiting-for-update message is displayed. Start/recovery paths seed freshness. Character monitoring includes all running states. Only the status, not the changing percentage, is announced in a polite live region.

Progress is available to customers in the generator, tools (including voice/video workflows), character task list and job history. It is not a guaranteed remaining-time estimate. Synchronous uploads and preflight checks without a persisted generation job do not report completion percentages.

## Promotional media

Two previously generated, branded 30-second public promotional films were selected: StartAIcreator_Product_Ad_EN_30s.mp4 and StartAIcreator_Cinematic_Models_EN_30s.mp4. They are served as optimized 540×960 H.264/AAC copies with native controls, inline mobile playback, posters and preload=none. Source originals remain unchanged. No private character/gallery query supplies these assets. The separate Create_And_Earn film is not included because its signup/monetization framing should be reconciled with launch availability first. The clips and English-language presentation are labelled in all eight page languages.

## Verification

Node 22.22.0: TypeScript passed; ESLint zero errors and nine inherited warnings; 529 tests passed, nine existing integration/live tests skipped; production build passed. The generated client bundle has no private owner email matches across 129 files. An independent read-only code review found progress freshness and owner-interface issues; both were fixed and checks rerun.

Browser visual and authenticated customer playback QA remains required before release. This executor's Chromium cannot open its required local sockets; the cloud browser cannot connect to the executor's loopback preview. Neither restriction was bypassed. No live provider generation was purchased or triggered. Production deployment must await normal CI, database and dependency/security release gates.

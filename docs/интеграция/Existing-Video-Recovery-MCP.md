# Existing owner video result reader

`syntx_owner_get_existing_video_recovery` is a read-only MCP tool for retrieving results from already-created owner video chats. It performs no upload, generation, replay, or automatic retry. A single request accepts one through six unique model/chat targets.

Each target supplies `model_id`, `chat_uuid`, `owner_message_id`, `provider_message_id`, and `expected_prompt`. The service binds the chat to the current linked owner's video index and the model-family title prefix, then verifies exact owner/bot message IDs, history model/prompt, and provider object ID equality between history and detail. Prompt comparison is in memory; prompt text is not returned. Safe R2 video URLs may be returned. Provider error text is never returned, and provider terminal status remains unproven.

Currently supported, source-backed reader profiles are:

- `dop-lite`, `dop-turbo`
- `hailuo-2.3-fast`, `hailuo-01-live-character`, `hailuo-3.0`
- `kling_elements`, `kling_o1_image2video`
- `wan_27_i2v`, `gen4.5i2v`
- `acttwo`
- `seedance-2.5`
- `switchx`

This is a bounded list of supported reader profiles, not a claim that every catalog model is recoverable through this tool. Targets must belong to the current owner's index and pass the corresponding family/history checks.

## ActTwo profile

For `acttwo`, `expected_prompt` must be exactly the empty string. Its owner history must contain one video and one image object; their order is not significant. It may additionally contain zero or one text object, whose `object_text` must be null or empty. Any present non-null owner `model_type` must be `acttwo`, and at least one owner video/image object must explicitly carry `model_type: "acttwo"`. The provider's bot object may be `video` or `error`; the reader derives that outcome from history and requires the detail response to match the same object ID, type, model, and message binding.

For every other supported model, the expected prompt must be non-empty and owner history must pass that profile's text/image checks. The MCP request allows at most six targets regardless of the number of supported profiles.

## Seedance 2.5 profile

`seedance-2.5` uses the observed `owner-contract-video-<chat_uuid>` index title
family. Its owner history must contain exactly one text object, with an exact
non-empty `expected_prompt`, `model_type: "seedance-2.5"` and
`completed: true`. No reference object is expected. The provider history and
detail must each bind exactly one completed video object to the supplied
provider message ID and the same model.

## Switchx profile

`switchx` uses the observed `owner-switchx-video-<chat_uuid>` title family. Its
owner message must contain exactly one text prompt object and one video input
object; both must echo `model_type: "switchx"` and `completed: true`. The text
must exactly match the non-empty `expected_prompt`, and the video reference URL
must pass the existing safe-reference URL check.

The provider message is the observed two-video form. Both rows must be
completed `video` objects with distinct object IDs and distinct safe URLs.
Detail must preserve both object IDs, model echoes, order and URLs exactly.
The public row keeps its backward-compatible primary `object_url` equal to the
first observed URL and adds an optional two-item `artifacts` array in observed
order. The reader does not assign names or roles to either output video. It
returns `unverified` if this exact two-video history/detail binding does not
hold.

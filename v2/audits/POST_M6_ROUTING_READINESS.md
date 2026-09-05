# Post-M6 routing readiness regression

Read-only canonical PostgresProductRoutingCompatibilityReader audit in PrintersHero-DEV / Development. No routing or Product data was changed. Before/after organization counts and every Product readiness status were identical.

| Scope | Active products | Active standard-production | Unroutable before | Unroutable after |
| --- | ---: | ---: | ---: | ---: |
| Primary operational organization | 21 | 17 | 0 | 0 |
| Sandbox organization | 13 | 10 | 10 | 10 |
| All DEV product-owning organizations | 96 | 89 | 72 | 72 |

After snapshot: 09/05/2026 00:51:39. The primary organization is 56e0f644-bb25-43ef-8ee1-473831115849; sandbox is d51ff3e7-75aa-462f-b0ab-3751bd888306. The remaining 62 unroutable products are historical rehearsal fixtures.

The primary regression passes: 11 products route by authored version and 6 by supported compatibility. Global DEV does not satisfy a zero-unroutable assertion. Keep compatibility and obtain an explicit retention/repair/archive decision for the candidates below; do not fabricate routes or delete Products to force zero. This is a review inventory, not a deletion manifest.

| Organization ID | Product ID | Readiness | Reason |
| --- | --- | --- | --- |
| d51ff3e7-75aa-462f-b0ab-3751bd888306 | aca0d66c-a331-432d-ab12-82169fd82de6 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| d51ff3e7-75aa-462f-b0ab-3751bd888306 | aa7bb33f-0981-4cfb-ad44-37d99aaf1d32 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| d51ff3e7-75aa-462f-b0ab-3751bd888306 | 99758f86-d72a-4f78-b9c3-e2083c361d60 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| d51ff3e7-75aa-462f-b0ab-3751bd888306 | 61650b61-7e7b-481d-8371-102684c06889 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| d51ff3e7-75aa-462f-b0ab-3751bd888306 | ae5bcdfd-2905-4335-b015-434664182b33 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| d51ff3e7-75aa-462f-b0ab-3751bd888306 | 8b68835b-d245-440a-8e9d-4614095eb17d | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| d51ff3e7-75aa-462f-b0ab-3751bd888306 | 3034c7ea-fb73-479a-840d-5ade0e8ecca8 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| d51ff3e7-75aa-462f-b0ab-3751bd888306 | 910b1029-aa05-40bd-82c4-7abd49bb308c | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| d51ff3e7-75aa-462f-b0ab-3751bd888306 | 8cade329-9133-4cd1-8c49-1169fb4fa5d2 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| d51ff3e7-75aa-462f-b0ab-3751bd888306 | 144b3508-64a4-4c0b-ad5e-4a99b959f27e | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| m21-b374288b-2dd9-4c3f-8e3d-db065abf5c46 | m21-product-b374288b-2dd9-4c3f-8e3d-db065abf5c46 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| m22-36f3c804-e1d0-47ab-8a84-f1d626c36e19 | m22-product-36f3c804-e1d0-47ab-8a84-f1d626c36e19 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| m23-431966f9-a5cf-4643-a0b7-d018f0f6edc8 | m23-product-431966f9-a5cf-4643-a0b7-d018f0f6edc8 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| m23-70cdec32-fb10-48c0-b716-e7ee570a502c | m23-product-70cdec32-fb10-48c0-b716-e7ee570a502c | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| m23-ad782618-33cb-4d25-9ab3-74628a958de6 | m23-product-ad782618-33cb-4d25-9ab3-74628a958de6 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7b-org-049c3d9e-6264-43b3-8143-c906966e9e18 | p7b-product-049c3d9e-6264-43b3-8143-c906966e9e18 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7b-org-1df59fc4-1027-4783-9e67-7e2b8b94180f | p7b-product-1df59fc4-1027-4783-9e67-7e2b8b94180f | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7b-org-22a4760e-3fcb-49b8-87b7-9222b2aeca38 | p7b-product-22a4760e-3fcb-49b8-87b7-9222b2aeca38 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7b-org-46f18d4e-e2f1-4e89-8517-01b4c8160a71 | p7b-product-46f18d4e-e2f1-4e89-8517-01b4c8160a71 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7b-org-4a06ca73-0d80-48db-9842-3bceb9bf0f3d | p7b-product-4a06ca73-0d80-48db-9842-3bceb9bf0f3d | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7b-org-b6f1bc8c-659d-4750-a1b5-40862c21ceec | p7b-product-b6f1bc8c-659d-4750-a1b5-40862c21ceec | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7b-org-c37042ac-c007-4b84-a4f2-6bab51aac0a6 | p7b-product-c37042ac-c007-4b84-a4f2-6bab51aac0a6 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7c-1a2701e9-960b-4a5e-a38d-efed970d7cae | p7c-product-1a2701e9-960b-4a5e-a38d-efed970d7cae | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7c-3edf1fb9-5218-4c94-a78d-428896d4b752 | p7c-product-3edf1fb9-5218-4c94-a78d-428896d4b752 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7c-403f0fa8-23a3-42fd-bfc2-58b1b5ac95d7 | p7c-product-403f0fa8-23a3-42fd-bfc2-58b1b5ac95d7 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7c-70102471-6ade-49e9-85af-1bfcfe38233b | p7c-product-70102471-6ade-49e9-85af-1bfcfe38233b | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7c-943505f7-f18c-4466-9016-282392e4b93d | p7c-product-943505f7-f18c-4466-9016-282392e4b93d | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7c-9eedc49d-cde0-4566-b993-51f316e3e64e | p7c-product-9eedc49d-cde0-4566-b993-51f316e3e64e | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7c-b935a841-77df-44cd-b537-772b09fdeff4 | p7c-product-b935a841-77df-44cd-b537-772b09fdeff4 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7c-c1daf981-4c2c-4828-aec4-942f20876daf | p7c-product-c1daf981-4c2c-4828-aec4-942f20876daf | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7c-d2a694a1-5819-4c23-ba42-31d753b44b42 | p7c-product-d2a694a1-5819-4c23-ba42-31d753b44b42 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7c-d6d47668-5e78-42ae-a183-74c891d022a8 | p7c-product-d6d47668-5e78-42ae-a183-74c891d022a8 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7c-d7402432-07f2-4ac1-a584-8cf0a189ca41 | p7c-product-d7402432-07f2-4ac1-a584-8cf0a189ca41 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7c-e3b0f7ac-6cd1-4a3b-9e4b-f52c6f33c663 | p7c-product-e3b0f7ac-6cd1-4a3b-9e4b-f52c6f33c663 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7d-0ad45ca0-695f-4b0a-9d08-07de3e21cd92 | p7d-product-0ad45ca0-695f-4b0a-9d08-07de3e21cd92 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7d-258c594d-3b10-415d-ba12-08fe0f1c704f | p7d-product-258c594d-3b10-415d-ba12-08fe0f1c704f | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7d-25b9c315-0228-4660-9857-a29a76949cba | p7d-product-25b9c315-0228-4660-9857-a29a76949cba | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7d-3b8b9030-5348-4944-9b55-1ec8ec990824 | p7d-product-3b8b9030-5348-4944-9b55-1ec8ec990824 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7d-4226c56e-492f-4153-9a13-e2a750e9301a | p7d-product-4226c56e-492f-4153-9a13-e2a750e9301a | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7d-47e38596-e0b7-4cdc-b5b0-a72e41e93432 | p7d-product-47e38596-e0b7-4cdc-b5b0-a72e41e93432 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7d-4bf8b4a4-d3f6-46d2-8121-ad164679e8fc | p7d-product-4bf8b4a4-d3f6-46d2-8121-ad164679e8fc | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7d-6096f781-197a-4d1e-9ec1-291567110562 | p7d-product-6096f781-197a-4d1e-9ec1-291567110562 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7d-6357b545-4899-4fee-b37d-12fd9f0ce10f | p7d-product-6357b545-4899-4fee-b37d-12fd9f0ce10f | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7d-6eea9ee1-dd21-4486-a1e7-b03b2557fd25 | p7d-product-6eea9ee1-dd21-4486-a1e7-b03b2557fd25 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7d-6f1a6f66-516d-4574-9e3a-2ca04af080a6 | p7d-product-6f1a6f66-516d-4574-9e3a-2ca04af080a6 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7d-85bbd3f1-2c70-44d6-b260-36d5143cf030 | p7d-product-85bbd3f1-2c70-44d6-b260-36d5143cf030 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7d-8bafa6ca-9e13-4eb9-9861-914618970aa1 | p7d-product-8bafa6ca-9e13-4eb9-9861-914618970aa1 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7d-8bbf167d-8cbc-48e2-99b8-14a2482c41e2 | p7d-product-8bbf167d-8cbc-48e2-99b8-14a2482c41e2 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7d-96153f09-2e47-4e52-9f4f-21dc4a357f42 | p7d-product-96153f09-2e47-4e52-9f4f-21dc4a357f42 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7d-97017c46-ddd2-4210-a335-bf06c2372735 | p7d-product-97017c46-ddd2-4210-a335-bf06c2372735 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7d-97e2309e-ad83-4a25-b4d6-3a88e62c18b3 | p7d-product-97e2309e-ad83-4a25-b4d6-3a88e62c18b3 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7d-9f08c9b5-8096-4aa6-80bc-e643227583ff | p7d-product-9f08c9b5-8096-4aa6-80bc-e643227583ff | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7d-a2e7c85f-c6b5-4211-8fa4-dda071385fe7 | p7d-product-a2e7c85f-c6b5-4211-8fa4-dda071385fe7 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7d-a6475e54-cf62-4947-bdce-a698527cbf97 | p7d-product-a6475e54-cf62-4947-bdce-a698527cbf97 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7d-a876794f-2611-4d57-8ca4-bfdf8fcd73b3 | p7d-product-a876794f-2611-4d57-8ca4-bfdf8fcd73b3 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7d-acaa2065-3afc-46e5-92d6-a2486df5c705 | p7d-product-acaa2065-3afc-46e5-92d6-a2486df5c705 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7d-ae054d1c-12c6-4c02-b885-851f715d5aea | p7d-product-ae054d1c-12c6-4c02-b885-851f715d5aea | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7d-b1e7969c-de1b-4b77-a882-b692d1f3c377 | p7d-product-b1e7969c-de1b-4b77-a882-b692d1f3c377 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7d-ba23c402-90c3-412c-ad48-d535330112bb | p7d-product-ba23c402-90c3-412c-ad48-d535330112bb | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7d-c59330ce-cd1e-43fc-961b-789f2c69358c | p7d-product-c59330ce-cd1e-43fc-961b-789f2c69358c | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7d-d7618038-6ac1-4b07-aeb7-e444b217ebc6 | p7d-product-d7618038-6ac1-4b07-aeb7-e444b217ebc6 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7d-d90722cf-e7f4-4d92-b05b-9ff71c1035e6 | p7d-product-d90722cf-e7f4-4d92-b05b-9ff71c1035e6 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7d-db57b770-18b5-4050-82af-5607e2035d3f | p7d-product-db57b770-18b5-4050-82af-5607e2035d3f | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7d-dce43903-9f7c-4906-82a3-d9c1da2c160d | p7d-product-dce43903-9f7c-4906-82a3-d9c1da2c160d | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7d-e1f7c52b-0f98-48c6-abd2-351e4da17c9d | p7d-product-e1f7c52b-0f98-48c6-abd2-351e4da17c9d | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7d-eee7ac6d-36b0-405e-906b-94b38ad987e1 | p7d-product-eee7ac6d-36b0-405e-906b-94b38ad987e1 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7d-f1fe17d6-3ba9-4651-bc56-e5266ca0e18b | p7d-product-f1fe17d6-3ba9-4651-bc56-e5266ca0e18b | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7d-f6a7f722-60ea-4353-b2fc-6925748489bc | p7d-product-f6a7f722-60ea-4353-b2fc-6925748489bc | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| p7d-f7c83458-800c-4aa9-84e8-46b34a3dea29 | p7d-product-f7c83458-800c-4aa9-84e8-46b34a3dea29 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| routing-http-org-0752cc46-02ff-40fc-a4b8-d0a37dac44d8 | routing-http-product-0752cc46-02ff-40fc-a4b8-d0a37dac44d8 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| routing-http-org-58337fb7-a2df-480d-935d-eab034e73b5f | routing-http-product-58337fb7-a2df-480d-935d-eab034e73b5f | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |
| routing-http-org-d2af9a65-5c6f-4f35-9609-e0b1ad70b324 | routing-http-product-d2af9a65-5c6f-4f35-9609-e0b1ad70b324 | UNROUTABLE_PRODUCTION_UNITS_MISSING | The active ProductVersion has no production units. |

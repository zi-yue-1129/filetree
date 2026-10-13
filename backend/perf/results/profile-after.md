Profile: `after.prof`. Separate diagnostic server lifetime;
these timings are not included in benchmark medians. Self time includes
profiling overhead. Coroutine counts include resumes; threaded/async
cumulative stacks overlap, so cumulative times are deliberately omitted.

| Function | Location | Calls/resumes | Self seconds |
|---|---|---:|---:|
| `get_user_files` | `backend/services/file_service.py:88` | 303 | 0.488 |
| `<method 'strftime' of 'datetime.date' objects>` | `builtin:0` | 505412 | 0.448 |
| `<method 'read' of '_io.BufferedReader' objects>` | `builtin:0` | 98016 | 0.355 |
| `<method 'update' of '_hashlib.HASH' objects>` | `builtin:0` | 4200 | 0.279 |
| `<method 'compress' of 'zlib.Compress' objects>` | `builtin:0` | 15449 | 0.258 |
| `get_urls` | `backend/services/note_service.py:41` | 234 | 0.107 |
| `_iterencode_dict` | `json/encoder.py:334` | 660100 | 0.080 |
| `_iterencode_list` | `json/encoder.py:278` | 660346 | 0.071 |
| `<method 'commit' of 'sqlite3.Connection' objects>` | `builtin:0` | 883 | 0.068 |
| `_iterencode` | `json/encoder.py:414` | 660346 | 0.054 |
| `<method 'flush' of 'zlib.Compress' objects>` | `builtin:0` | 7974 | 0.050 |
| `upload_tus_chunk` | `backend/routes/tus.py:397` | 45315 | 0.048 |
| `update_offset` | `backend/services/tus_metadata_store.py:189` | 840 | 0.039 |
| `_get_user_folders` | `backend/services/user_service.py:333` | 1245 | 0.038 |
| `<genexpr>` | `backend/routes/users.py:86` | 390490 | 0.038 |
| `download_folder` | `backend/routes/folders.py:304` | 280 | 0.038 |
| `<method 'execute' of 'sqlite3.Connection' objects>` | `builtin:0` | 1769 | 0.030 |
| `encode` | `json/encoder.py:183` | 965 | 0.030 |
| `<lambda>` | `backend/services/dedup_service.py:44` | 4221 | 0.022 |
| `get_user_dashboard` | `backend/routes/users.py:26` | 702 | 0.021 |
| `deduplicate` | `backend/services/dedup_service.py:48` | 42 | 0.019 |
| `__call__` | `backend/core/compression.py:21` | 55777 | 0.013 |
| `_get_connection` | `backend/services/tus_metadata_store.py:68` | 3532 | 0.013 |
| `get_upload` | `backend/services/tus_metadata_store.py:149` | 861 | 0.012 |
| `folder_path_names_from_map` | `backend/services/user_service.py:638` | 10476 | 0.012 |

Profile: `before.prof`. Separate diagnostic server lifetime;
these timings are not included in benchmark medians. Self time includes
profiling overhead. Coroutine counts include resumes; threaded/async
cumulative stacks overlap, so cumulative times are deliberately omitted.

| Function | Location | Calls/resumes | Self seconds |
|---|---|---:|---:|
| `<method 'compress' of 'zlib.Compress' objects>` | `builtin:0` | 81495 | 8.571 |
| `<method 'update' of '_hashlib.HASH' objects>` | `builtin:0` | 1075200 | 2.307 |
| `<method 'read' of '_io.BufferedReader' objects>` | `builtin:0` | 1169012 | 2.255 |
| `<method 'commit' of 'sqlite3.Connection' objects>` | `builtin:0` | 883 | 1.274 |
| `<method 'close' of 'sqlite3.Connection' objects>` | `builtin:0` | 1766 | 0.820 |
| `<lambda>` | `backend/services/dedup_service.py:40` | 1075221 | 0.713 |
| `get_user_files` | `backend/services/file_service.py:88` | 261 | 0.693 |
| `<method 'join' of 'bytes' objects>` | `builtin:0` | 3000 | 0.657 |
| `<method 'strftime' of 'datetime.date' objects>` | `builtin:0` | 435401 | 0.447 |
| `<method 'flush' of 'zlib.Compress' objects>` | `builtin:0` | 10770 | 0.207 |
| `<method 'execute' of 'sqlite3.Connection' objects>` | `builtin:0` | 3534 | 0.190 |
| `_iterencode_dict` | `json/encoder.py:334` | 660100 | 0.084 |
| `get_urls` | `backend/services/note_service.py:41` | 192 | 0.076 |
| `_iterencode_list` | `json/encoder.py:278` | 660346 | 0.074 |
| `_iterencode` | `json/encoder.py:414` | 660346 | 0.056 |
| `_get_user_folders` | `backend/services/user_service.py:333` | 1395 | 0.047 |
| `<genexpr>` | `backend/routes/users.py:84` | 320465 | 0.037 |
| `encode` | `json/encoder.py:183` | 965 | 0.031 |
| `upload_tus_chunk` | `backend/routes/tus.py:392` | 20789 | 0.025 |
| `download_folder` | `backend/routes/folders.py:301` | 253 | 0.025 |
| `_get_folder_path` | `backend/services/file_service.py:66` | 10495 | 0.015 |
| `batch_download` | `backend/routes/files.py:702` | 207 | 0.014 |
| `_get_connection` | `backend/services/tus_metadata_store.py:65` | 3532 | 0.010 |
| `calculate_hash` | `backend/services/dedup_service.py:36` | 21 | 0.009 |
| `folder_path_names_from_map` | `backend/services/user_service.py:635` | 4600 | 0.008 |

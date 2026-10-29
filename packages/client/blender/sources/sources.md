# Texture sources

Only these five images are committed (about 240 KB in total). Every one is a Poly Haven texture, which Poly Haven licenses as **CC0 1.0** (public domain dedication, no attribution required; https://polyhaven.com/license). The credit lines below are given anyway.

All files are the Poly Haven 1K JPG downloads (diffuse and OpenGL normal) resized to 512 px with sharp (lanczos3 kernel, JPEG quality 88, mozjpeg), so the sources folder stays far below the 6 MB limit. Roughness, displacement and AO maps were not downloaded.

| File | Asset | Author | Licence | Used for |
| --- | --- | --- | --- | --- |
| `rock_boulder_dry_diff.jpg`, `rock_boulder_dry_nor_gl.jpg` | https://polyhaven.com/a/rock_boulder_dry | Dimitrios Savva (photography), Rico Cilliers (processing) | CC0 1.0 | statue, hat stone, pedestal, steps, rocks |
| `grey_stone_path_diff.jpg`, `grey_stone_path_nor_gl.jpg` | https://polyhaven.com/a/grey_stone_path | Amal Kumar | CC0 1.0 | plaza and ground |
| `tatami_mat_diff.jpg` | https://polyhaven.com/a/tatami_mat | Charlotte Baglioni | CC0 1.0 | the woven mat (돗자리), tinted straw by the material |

## Considered and not used

- `granite_tile_02` (Poly Haven, CC0): the 1K diffuse is a brown tile floor with a dark grid, not granite, so steps and pedestal use `rock_boulder_dry` instead.
- Kenney Nature Kit, ambientCG granite and straw, Sketchfab maple models, the happykeys pine and the Jagobo maple: licence not confirmed, or over the polygon and size budgets.

## Procedural, no external source

The Gatbawi statue (figure, hat stone, pedestal, offering table and chrysanthemum pots), the pines and the maples are modelled in Blender by `gatbawi.py` and `world.py`. No scan or photograph is traced; the two reference press photos in `docs/reference` were looked at for proportions only and are not part of the repository.

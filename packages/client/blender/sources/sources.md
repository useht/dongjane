# Texture sources

Only these five images are committed (about 240 KB in total). Every one is a Poly Haven texture, which Poly Haven licenses as **CC0 1.0** (public domain dedication, no attribution required; https://polyhaven.com/license). The credit lines below are given anyway.

All files are the Poly Haven 1K JPG downloads (diffuse and OpenGL normal) resized to 512 px with sharp (lanczos3 kernel, JPEG quality 88, mozjpeg), so the sources folder stays far below the 6 MB limit. Roughness, displacement and AO maps were not downloaded.

| File | Asset | Author | Licence | Used for |
| --- | --- | --- | --- | --- |
| `rock_boulder_dry_diff.jpg`, `rock_boulder_dry_nor_gl.jpg` | https://polyhaven.com/a/rock_boulder_dry | Dimitrios Savva (photography), Rico Cilliers (processing) | CC0 1.0 | hat stone, pedestal, steps, rocks |
| `grey_stone_path_diff.jpg`, `grey_stone_path_nor_gl.jpg` | https://polyhaven.com/a/grey_stone_path | Amal Kumar | CC0 1.0 | plaza and ground |
| `tatami_mat_diff.jpg` | https://polyhaven.com/a/tatami_mat | Charlotte Baglioni | CC0 1.0 | the woven mat (돗자리), tinted straw by the material |


## The Buddha: a museum scan (`buddha/`)

The Buddha - Gatbawi's statue on the hill and the gilt Buddha on the 법당's altar - is made from the 3D model of the **석조여래좌상** (부여 군수리 석조여래좌상, found 1963, 보물, 소장품번호 M번435) of the 국립중앙박물관 (National Museum of Korea).

- Page: https://www.museum.go.kr/MUSEUM/contents/M0505000000.do?schM=view&searchId=search&relicId=188866 (relicId 188866, file 31744)
- Author: 국립중앙박물관. Licence: **공공누리 (KOGL) 제1유형, 출처표시**. The museum's statement, verbatim: 국립중앙박물관이(가) 창작한 석조여래좌상 저작물은 공공누리 "출처표시" 조건에 따라 이용할 수 있습니다.
- The museum's notice, verbatim: 지정문화유산의 실물 복제품을 제작하고자 하는 경우는 별도의 허가 신청이 필요합니다. It is about physical replicas of the heritage object; this game only shows the model on a screen and makes no replica. If anyone prints it or casts it, they must ask the museum first.
- The credit the licence asks for is shown in the game's settings sheet (소리와 모델 출처, `src/ui/credits.ts`).

| File | sha256 |
| --- | --- |
| `mno000435-30004.obj` (5.35 MB, the scan) | `0bdafabb6560cf1881b1b2067287b88cf611b483eb10c869ef25bf1f8fde2269` |
| `mno000435-30004.mtl` (the museum's material file, fixed to name the picture below) | `4d675e73bb3b0f959e74f00906ddd55461df620c607ba06ca8df07b578dc0348` |
| `museum31744_diffuse_2048_q85.jpg` (the museum's 18.4 MB picture, shrunk to 2048 px, 686 KB) | `2b1d8a220495c0b7c037a105c1862dd2c6fe760381a4a2a1f1d73778d9378a6b` |

`source.json` records the same page, file, hashes, author, licence and notice, and the model's axes (up Y, front +Z). The OBJ's sha256 goes into the asset stamp, so a different source changes it. Not committed, on purpose: the museum's 프린트_STL (printing mesh), the PLY and the original 18.4 MB picture. The scan's own photograph is not used: `buddha.py` bakes ambient occlusion and cavity shading of the scan onto a 16,000-triangle copy, and the game paints it granite (on the hill) or gold (in the 법당).

To swap in another model, change `source.json` (url, file, sha256, author, licence, axes) and put the file beside it - or, for a file over about 25 MB, leave it out and give `source.json` a `download` URL: `pnpm assets` fetches it into the git-ignored `blender/.cache` and checks the sha256. Nothing else changes. A Sketchfab "KHS" model (CC BY 4.0) was considered and not downloaded, because Sketchfab needs a login.

## Considered and not used

- `granite_tile_02` (Poly Haven, CC0): the 1K diffuse is a brown tile floor with a dark grid, not granite, so steps and pedestal use `rock_boulder_dry` instead.
- Kenney Nature Kit, ambientCG granite and straw, Sketchfab maple models, the happykeys pine and the Jagobo maple: licence not confirmed, or over the polygon and size budgets.

## Procedural, no external source

The Gatbawi hat stone, the pedestal, the offering table and chrysanthemum pots, the pines and the maples are modelled in Blender by `gatbawi.py` and `world.py`. No scan or photograph is traced for them; the two reference press photos in `docs/reference` were looked at for proportions only and are not used as textures.

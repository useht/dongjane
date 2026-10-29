"""Entry point, run by `pnpm assets` inside Blender:

    blender --background --factory-startup --python blender/build.py -- --inputs <json> --out <dir>
"""

import os
import sys
import tempfile

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import buddha  # noqa: E402
import common  # noqa: E402
import flat_textures  # noqa: E402
import world  # noqa: E402
import monk  # noqa: E402


def main():
    args = common.parse_args()
    inputs = common.load_inputs(args.inputs)
    os.makedirs(args.out, exist_ok=True)
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as pictures_dir:
        pictures = flat_textures.build(inputs, pictures_dir)
        common.reset_scene()
        monk.build(inputs, args.out)
        common.reset_scene()
        buddha.build(inputs, args.out)
        common.reset_scene()
        world.build(inputs, args.out, pictures)


main()

"""Entry point, run by `pnpm assets` inside Blender:

    blender --background --factory-startup --python blender/build.py -- --inputs <json> --out <dir>
"""

import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import buddha  # noqa: E402
import common  # noqa: E402
import dharma  # noqa: E402
import gatbawi  # noqa: E402
import venue  # noqa: E402
import world  # noqa: E402


def main():
    args = common.parse_args()
    inputs = common.load_inputs(args.inputs)
    os.makedirs(args.out, exist_ok=True)
    common.reset_scene()
    head = buddha.build(inputs, args.out)
    common.reset_scene()
    gatbawi.build(inputs, args.out, head)
    common.reset_scene()
    world.build(inputs, args.out)
    common.reset_scene()
    venue.build(inputs, args.out)
    common.reset_scene()
    dharma.build(inputs, args.out, head)


main()

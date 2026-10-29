"""Entry point, run by `pnpm assets` inside Blender:

    blender --background --factory-startup --python blender/build.py -- --inputs <json> --out <dir>
"""

import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common  # noqa: E402
import monk  # noqa: E402


def main():
    args = common.parse_args()
    inputs = common.load_inputs(args.inputs)
    os.makedirs(args.out, exist_ok=True)
    common.reset_scene()
    monk.build(inputs, args.out)


main()

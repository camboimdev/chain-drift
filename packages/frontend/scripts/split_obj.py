import os
import sys


def split_obj(input_file, output_dir):
    # Get base name for prefix (e.g. "Car" from "public/Car.obj")
    base_name = os.path.splitext(os.path.basename(input_file))[0]

    try:
        with open(input_file, "r") as f:
            lines = f.readlines()
    except FileNotFoundError:
        print(f"Error: Could not find file {input_file}")
        return

    common_header = []
    parts = {}
    current_material = "Default"

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        if (
            stripped.startswith("v ")
            or stripped.startswith("vn ")
            or stripped.startswith("vt ")
            or stripped.startswith("mtllib")
            or stripped.startswith("#")
        ):
            common_header.append(line)
        elif stripped.startswith("usemtl "):
            current_material = stripped.split()[1]
            if current_material not in parts:
                parts[current_material] = []
            parts[current_material].append(line)
        elif stripped.startswith("f "):
            if current_material not in parts:
                parts[current_material] = []
            parts[current_material].append(line)
        elif stripped.startswith("o ") or stripped.startswith("g "):
            common_header.append(line)
        elif stripped.startswith("s "):
            if current_material not in parts:
                parts[current_material] = []
            parts[current_material].append(line)

    # Write parts
    for material, lines in parts.items():
        # Clean material name just in case
        safe_mat = "".join(x for x in material if x.isalnum() or x in "_-")
        filename = f"{base_name}_{safe_mat}.obj"
        filepath = os.path.join(output_dir, filename)

        print(f"Writing {filepath}...")
        with open(filepath, "w") as f:
            f.writelines(common_header)
            f.writelines(lines)


if __name__ == "__main__":
    # Default to Car.obj if no argument provided
    input_file = sys.argv[1] if len(sys.argv) > 1 else "public/Car.obj"
    output_folder = "public/parts"

    if not os.path.exists(output_folder):
        os.makedirs(output_folder)

    print(f"Splitting {input_file} into {output_folder}...")
    split_obj(input_file, output_folder)
    print("Done.")

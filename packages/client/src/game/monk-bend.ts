import { MeshDepthMaterial, MeshLambertMaterial, Vector3 } from "three";
import rig from "../../assets/monk/monk-rig.json";

// The one bend the jacket takes when a monk bows, a copy of bend_vertex in packages/client/assets/monk/build_monk.py (which checks the
// whole bow against it; test/monk-bend.test.ts holds this copy to the numbers that script writes). It works in the waist frame, with
// h the height (three.js's y), f the forward distance (-z) and x untouched. Below the base (h = -BEND_LENGTH) nothing moves. From there
// up to the hinge (h = 0) the jacket curves forward at the constant rate theta / BEND_LENGTH about the axis f = BEND_FORWARD, and from
// the hinge up to the neck (h = BEND_NECK) at the constant rate theta * BEND_UPPER / BEND_NECK: the lower back, then the hump. Above
// the neck it is one rigid body that keeps the curve's end tangent (bendFrameAt).
export const BEND_LENGTH = rig.bendLength;
export const BEND_FORWARD = rig.bendForward;
export const BEND_NECK = rig.neckY;
export const BEND_UPPER = rig.bendUpper / rig.bowLean;
const STRAIGHT = 1e-4;
const MEET = 1e-5;

// The axis of the bend at the upright height h (already gathered): where it is, the angle it has turned to there and the rate at
// which it turns there. A surface squeezed along the axis stretches by 1 - rate * its distance in front of the axis; where two spans
// meet the rate is their mean, so a ring of the jacket there is shaded as the seam between them.
const AXIS = { f: 0, h: 0, phi: 0, rate: 0 };

function bendAxis(h: number, theta: number): typeof AXIS {
  const low = theta / BEND_LENGTH;
  const high = (theta * BEND_UPPER) / BEND_NECK;
  if (Math.abs(h) < MEET) AXIS.rate = (low + high) / 2;
  else if (Math.abs(h - BEND_NECK) < MEET) AXIS.rate = high / 2;
  else if (h > -BEND_LENGTH && h < 0) AXIS.rate = low;
  else if (h > 0 && h < BEND_NECK) AXIS.rate = high;
  else AXIS.rate = 0;
  if (h <= 0) {
    const u = h + BEND_LENGTH;
    const s = Math.min(Math.max(u, 0), BEND_LENGTH);
    AXIS.phi = low * s;
    const c = Math.cos(AXIS.phi);
    const sn = Math.sin(AXIS.phi);
    AXIS.f = BEND_FORWARD + (1 - c) / low + (u - s) * sn;
    AXIS.h = -BEND_LENGTH + sn / low + (u - s) * c;
    return AXIS;
  }
  const v = Math.min(h, BEND_NECK);
  AXIS.phi = theta + high * v;
  const c = Math.cos(AXIS.phi);
  const sn = Math.sin(AXIS.phi);
  const ca = Math.cos(theta);
  const sa = Math.sin(theta);
  AXIS.f = BEND_FORWARD + (1 - ca) / low + (ca - c) / high + (h - v) * sn;
  AXIS.h = -BEND_LENGTH + sa / low + (sn - sa) / high + (h - v) * c;
  return AXIS;
}

// Where the upright point `point` of the jacket goes at the bow angle `theta`. Below the hinge it is first shortened by the gather
// (1 standing, less when the jacket is gathered over the thighs of a kneeling or seated monk).
export function bendPoint(point: Vector3, theta: number, gather: number, out: Vector3): Vector3 {
  const f = -point.z;
  const h = point.y < 0 ? point.y * gather : point.y;
  if (theta < STRAIGHT) return out.set(point.x, h, -f);
  const axis = bendAxis(h, theta);
  const o = f - BEND_FORWARD;
  return out.set(point.x, axis.h - o * Math.sin(axis.phi), -(axis.f + o * Math.cos(axis.phi)));
}

// The shading normal of the upright point `point` once bent: the normal turns with the curve, and the front, which the bend
// compresses, tilts the way a surface does that is squeezed along the axis.
export function bendNormal(point: Vector3, normal: Vector3, theta: number, gather: number, out: Vector3): Vector3 {
  const f = -point.z;
  const below = point.y < 0;
  const h = below ? point.y * gather : point.y;
  const nh = below ? normal.y / gather : normal.y;
  const nf = -normal.z;
  if (theta < STRAIGHT) return out.set(normal.x, nh, -nf).normalize();
  const axis = bendAxis(h, theta);
  const o = f - BEND_FORWARD;
  const c = Math.cos(axis.phi);
  const sn = Math.sin(axis.phi);
  const ns = nh / (1 - axis.rate * o);
  return out.set(normal.x, -nf * sn + ns * c, -(nf * c + ns * sn)).normalize();
}

// How far forward the bend has turned the upright height h by the bow angle theta: the rotation (rotation.x = -tilt) of the frame
// that height rides in.
export function bendTilt(h: number, theta: number): number {
  return theta < STRAIGHT ? 0 : bendAxis(h, theta).phi;
}

const ORIGIN = new Vector3();

// Where the bend puts the point of the middle plane (f = 0) at the upright height h: the origin of the frame that height rides in,
// which is also turned forward by bendTilt(h, theta). The hinge's is the waist pivot, the lean of the chest; the head rides the
// neck's; a shoulder slid down the chest rides the one of the height it slid to.
export function bendFrameAt(h: number, theta: number, out: Vector3): Vector3 {
  return bendPoint(ORIGIN.set(0, h, 0), theta, 1, out);
}

// Floats written for GLSL need a decimal point (or an exponent): 0.2 stays 0.2, 1 becomes 1.0.
function glslFloat(value: number): string {
  const text = String(value);
  return /[.e]/.test(text) ? text : `${text}.0`;
}

// The same bend as bendPoint and bendNormal, per vertex in the vertex shader: monks are InstancedMeshes that share one geometry per
// part, so each instance carries its own bend as the attribute instanceBend (theta, gather).
const BEND_PARS = /* glsl */ `
attribute vec2 instanceBend;

const float BEND_LENGTH = ${glslFloat(BEND_LENGTH)};
const float BEND_FORWARD = ${glslFloat(BEND_FORWARD)};
const float BEND_NECK = ${glslFloat(BEND_NECK)};
const float BEND_UPPER = ${glslFloat(BEND_UPPER)};

// The axis of the bend at the height h: its (f, h), and in phi the angle it has turned to and in rate the rate it turns at there.
vec2 bendAxis( float h, float theta, out float phi, out float rate ) {
	float low = theta / BEND_LENGTH;
	float high = theta * BEND_UPPER / BEND_NECK;
	if ( abs( h ) < ${glslFloat(MEET)} ) rate = ( low + high ) / 2.0;
	else if ( abs( h - BEND_NECK ) < ${glslFloat(MEET)} ) rate = high / 2.0;
	else if ( h > - BEND_LENGTH && h < 0.0 ) rate = low;
	else if ( h > 0.0 && h < BEND_NECK ) rate = high;
	else rate = 0.0;
	if ( h <= 0.0 ) {
		float u = h + BEND_LENGTH;
		float s = clamp( u, 0.0, BEND_LENGTH );
		phi = low * s;
		float c = cos( phi );
		float sn = sin( phi );
		return vec2( BEND_FORWARD + ( 1.0 - c ) / low + ( u - s ) * sn, - BEND_LENGTH + sn / low + ( u - s ) * c );
	}
	float v = min( h, BEND_NECK );
	phi = theta + high * v;
	float c = cos( phi );
	float sn = sin( phi );
	float ca = cos( theta );
	float sa = sin( theta );
	return vec2(
		BEND_FORWARD + ( 1.0 - ca ) / low + ( ca - c ) / high + ( h - v ) * sn,
		- BEND_LENGTH + sa / low + ( sn - sa ) / high + ( h - v ) * c
	);
}

vec3 bendPoint( vec3 p, float theta, float gather ) {
	float f = - p.z;
	float h = p.y < 0.0 ? p.y * gather : p.y;
	if ( theta < ${glslFloat(STRAIGHT)} ) return vec3( p.x, h, - f );
	float phi;
	float rate;
	vec2 axis = bendAxis( h, theta, phi, rate );
	float o = f - BEND_FORWARD;
	return vec3( p.x, axis.y - o * sin( phi ), - ( axis.x + o * cos( phi ) ) );
}

vec3 bendNormal( vec3 p, vec3 n, float theta, float gather ) {
	float f = - p.z;
	bool below = p.y < 0.0;
	float h = below ? p.y * gather : p.y;
	float nh = below ? n.y / gather : n.y;
	float nf = - n.z;
	if ( theta < ${glslFloat(STRAIGHT)} ) return normalize( vec3( n.x, nh, - nf ) );
	float phi;
	float rate;
	bendAxis( h, theta, phi, rate );
	float o = f - BEND_FORWARD;
	float c = cos( phi );
	float sn = sin( phi );
	float ns = nh / ( 1.0 - rate * o );
	return normalize( vec3( n.x, - nf * sn + ns * c, - ( nf * c + ns * sn ) ) );
}
`;

const BEND_POINT = "transformed = bendPoint( transformed, instanceBend.x, instanceBend.y );";
const BEND_NORMAL = "objectNormal = bendNormal( position, objectNormal, instanceBend.x, instanceBend.y );";

function after(source: string, include: string, code: string): string {
  const at = source.indexOf(include);
  if (at < 0) throw new Error(`monk bend: the shader has no ${include}`);
  return source.slice(0, at + include.length) + "\n" + code + source.slice(at + include.length);
}

export function bendVertexShader(source: string, withNormal: boolean): string {
  const bent = after(source, "#include <common>", BEND_PARS);
  const moved = after(bent, "#include <begin_vertex>", BEND_POINT);
  return withNormal ? after(moved, "#include <beginnormal_vertex>", BEND_NORMAL) : moved;
}

// The lit material bends the points and the normals; the depth material the shadow pass draws with bends only the points, and must
// be set as the mesh's customDepthMaterial, or the shadow stays upright while the monk bows.
export function bentMaterial(): MeshLambertMaterial {
  const material = new MeshLambertMaterial({ vertexColors: true });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = bendVertexShader(shader.vertexShader, true);
  };
  material.customProgramCacheKey = () => "monk-bend";
  return material;
}

export function bentDepthMaterial(): MeshDepthMaterial {
  const material = new MeshDepthMaterial();
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = bendVertexShader(shader.vertexShader, false);
  };
  material.customProgramCacheKey = () => "monk-bend-depth";
  return material;
}

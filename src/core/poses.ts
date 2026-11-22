import { emptyPose } from './rig';
import type { JointName, Pose, PoseData, Vec3 } from './types';

export type { PoseData };

export const POSES: Record<string, PoseData> = {
  stand: { joints: {} },
  t_pose: { joints: { L_shoulder: [0, 0, 90], R_shoulder: [0, 0, -90] } },
  crouch: {
    hipsPos: [0, -0.5, -0.2],
    joints: {
      spine: [15, 0, 0], chest: [10, 0, 0],
      L_hip: [-95, 0, 8], R_hip: [-95, 0, -8],
      L_knee: [120, 0, 0], R_knee: [120, 0, 0],
      L_ankle: [-25, 0, 0], R_ankle: [-25, 0, 0],
      L_shoulder: [-40, 0, 5], R_shoulder: [-40, 0, -5],
      L_elbow: [-30, 0, 0], R_elbow: [-30, 0, 0],
    },
  },
  kneel: {
    hipsPos: [0, -0.42, -0.2],
    joints: {
      spine: [8, 0, 0],
      L_hip: [-90, 0, 4], L_knee: [90, 0, 0],
      R_hip: [0, 0, -4], R_knee: [90, 0, 0], R_ankle: [20, 0, 0],
      L_shoulder: [-20, 0, 5], R_shoulder: [-20, 0, -5],
    },
  },
  point: {
    joints: {
      R_shoulder: [-85, 0, -10],
      L_shoulder: [0, 0, 8],
      head: [0, 12, 0],
    },
  },
  wave_up: {
    joints: {
      R_shoulder: [-10, 0, -150],
      R_elbow: [-35, 0, 0],
      R_wrist: [0, 0, -10],
      L_shoulder: [0, 0, 8],
    },
  },
};

export const POSE_NAMES = Object.keys(POSES);

/** Resolve a preset name or pose data to a full pose (+hips offset). */
export function resolvePose(p: string | PoseData, custom: Record<string, PoseData> = {}): { pose: Pose; hipsPos: Vec3 } {
  const data = typeof p === 'string' ? (POSES[p] ?? custom[p]) : p;
  if (!data || !data.joints) throw new Error(`Unknown pose: ${String(p)} (presets: ${POSE_NAMES.join(', ')}; custom: ${Object.keys(custom).join(', ') || 'none'})`);
  const pose = emptyPose();
  for (const [k, v] of Object.entries(data.joints)) {
    if (k in pose && v) pose[k as JointName] = [v[0], v[1], v[2]];
  }
  return { pose, hipsPos: data.hipsPos ? [data.hipsPos[0], data.hipsPos[1], data.hipsPos[2]] : [0, 0, 0] };
}

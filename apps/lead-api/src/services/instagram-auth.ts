import { execSync } from 'child_process';
import { resolve } from 'path';
import { logger } from '@alh/observability';

const HELPER_SCRIPT = resolve(__dirname, '../../../../scripts/ig-auth-helper.py');

export interface IgAccountInfo {
  ig_user_id: string;
  ig_username: string;
  full_name: string;
  biography: string;
  follower_count: number;
  following_count: number;
  media_count: number;
  is_business: boolean;
  profile_pic_url: string | null;
  category: string | null;
}

export interface IgLoginResult {
  status: 'connected' | 'two_factor_required' | 'checkpoint_required';
  account?: IgAccountInfo;
  session_json?: string;
  two_factor_identifier?: string;
  message?: string;
}

export interface IgProfileResult {
  account: IgAccountInfo;
  recent_captions: string[];
}

function runPython(command: string, input: Record<string, unknown>): unknown {
  const inputJson = JSON.stringify(input);

  try {
    const result = execSync(
      `python3 "${HELPER_SCRIPT}" ${command}`,
      {
        input: inputJson,
        encoding: 'utf-8',
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env },
      },
    );

    const parsed = JSON.parse(result.trim());

    if (parsed.error) {
      throw new Error(parsed.error);
    }

    return parsed;
  } catch (err: unknown) {
    const error = err as Error & { stdout?: string; stderr?: string };

    // If the process returned JSON with an error, it was already thrown above.
    // Otherwise try to parse stdout for structured errors.
    if (error.stdout) {
      try {
        const parsed = JSON.parse(error.stdout.trim());
        if (parsed.error) {
          throw new Error(parsed.error);
        }
        // If it parsed fine but process exited non-zero, return the parsed result anyway
        // (e.g. 2FA required exits with code 0 but some edge cases might not)
        return parsed;
      } catch (parseErr) {
        // stdout wasn't JSON
      }
    }

    logger.error({ err: error, command, stderr: error.stderr }, 'Instagram auth helper failed');
    throw new Error(`Instagram authentication failed: ${error.message}`);
  }
}

export async function igLogin(username: string, password: string): Promise<IgLoginResult> {
  const result = runPython('login', { username, password }) as IgLoginResult;
  return result;
}

export async function igVerify2FA(
  username: string,
  code: string,
  sessionJson?: string,
): Promise<IgLoginResult> {
  const result = runPython('verify-2fa', {
    username,
    code,
    session_json: sessionJson || '',
  }) as IgLoginResult;
  return result;
}

export async function igGetProfile(sessionJson: string): Promise<IgProfileResult> {
  const result = runPython('get-profile', { session_json: sessionJson }) as IgProfileResult;
  return result;
}

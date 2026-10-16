import * as exec from '@actions/exec';
import * as io from '@actions/io';

import { getVariables } from '../actions/preview-build';
import {
  AppPlatform,
  BuildInfo,
  BuildStatus,
  createEasBuildFromRawCommandAsync,
  easBuild,
  getBuildLogsUrl,
  normalizeBuildInfo,
  queryEasBuildInfoAsync,
} from '../expo';
import { getBuildInfoWithFingerprintAsync } from '../fingerprintUtils';

jest.mock('@actions/core');
jest.mock('@actions/exec');
jest.mock('@actions/io');
jest.mock('../worker');

const legacyBuild: BuildInfo = {
  id: 'build-id',
  platform: AppPlatform.Android,
  project: { slug: 'example-app', ownerAccount: { name: 'example-owner' } },
  channel: 'preview',
  distribution: 'INTERNAL',
  buildProfile: 'preview',
  runtimeVersion: 'fingerprint-hash',
  sdkVersion: '57.0.0',
  appVersion: '1.0.0',
  gitCommitHash: 'commit-sha',
  expirationDate: '2099-01-01T00:00:00.000Z',
  status: BuildStatus.Finished,
};
const { project, channel, runtimeVersion, ...sharedFields } = legacyBuild;
const modernBuild = {
  ...sharedFields,
  app: project,
  updateChannel: { id: 'channel-id', name: channel },
  runtime: { id: 'runtime-id', version: runtimeVersion! },
};
const buildUrl = 'https://expo.dev/accounts/example-owner/projects/example-app/builds/build-id';

function mockCliOutput(value: unknown) {
  jest.mocked(io.which).mockResolvedValue('eas');
  jest.mocked(exec.getExecOutput).mockResolvedValue({
    exitCode: 0,
    stdout: JSON.stringify(value),
    stderr: '',
  });
}

describe.each([
  ['EAS CLI 21', legacyBuild],
  ['EAS CLI 22+', modernBuild],
] as const)('%s build responses', (_version, response) => {
  it('preserves build details and generates the build page link', () => {
    const build = normalizeBuildInfo(response);

    expect(build).toMatchObject(legacyBuild);
    expect(getBuildLogsUrl(build)).toBe(buildUrl);
    expect(normalizeBuildInfo(build)).toEqual(build);
  });

  it('normalizes builds created by the command action', async () => {
    mockCliOutput([response]);

    const builds = await easBuild({
      cli: 'eas',
      args: ['build'],
      raw: 'eas build',
      command: 'build',
    });

    expect(builds).toHaveLength(1);
    expect(builds[0]).toMatchObject(legacyBuild);
    expect(getBuildLogsUrl(builds[0])).toBe(buildUrl);
  });

  it('generates preview links for newly queued Android and iOS builds', async () => {
    mockCliOutput([response, { ...response, id: 'ios-build-id', platform: AppPlatform.Ios }]);

    const builds = await createEasBuildFromRawCommandAsync('fake/path', 'build --platform all');
    const variables = getVariables(
      { name: 'Example', slug: 'example-app', extra: { eas: { projectId: 'project-id' } } },
      builds
    );

    expect(variables.androidLink).toBe(buildUrl);
    expect(variables.iosLink).toBe(buildUrl.replace('/build-id', '/ios-build-id'));
    expect(variables.gitCommitHash).toBe('commit-sha');
  });

  it('generates a link for an existing compatible build', async () => {
    mockCliOutput(response);

    const build = await queryEasBuildInfoAsync('fake/path', response.id);

    expect(build).toMatchObject(legacyBuild);
    expect(getBuildLogsUrl(build!)).toBe(buildUrl);
  });

  it('normalizes a build found by its fingerprint', async () => {
    mockCliOutput([response]);

    const build = await getBuildInfoWithFingerprintAsync({
      cwd: 'fake/path',
      platform: 'android',
      profile: 'preview',
      fingerprintHash: 'fingerprint-hash',
      excludeExpiredBuilds: true,
    });

    expect(build).toMatchObject(legacyBuild);
    expect(getBuildLogsUrl(build!)).toBe(buildUrl);
  });
});

it.each([null, undefined])('handles absent channel and runtime metadata (%s)', value => {
  const build = normalizeBuildInfo({ ...modernBuild, updateChannel: value, runtime: value });

  expect(build.channel).toBe('');
  expect(build.runtimeVersion).toBeUndefined();
  expect(getBuildLogsUrl(build)).toBe(buildUrl);
});

it('preserves an empty fingerprint search result', async () => {
  mockCliOutput([]);

  await expect(
    getBuildInfoWithFingerprintAsync({
      cwd: 'fake/path',
      platform: 'android',
      profile: 'preview',
      fingerprintHash: 'fingerprint-hash',
      excludeExpiredBuilds: true,
    })
  ).resolves.toBeNull();
});

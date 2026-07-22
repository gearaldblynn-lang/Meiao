const DEFAULT_LOCK_NAME = 'meiao:job-claim-deploy-barrier';
const DEFAULT_LOCK_TIMEOUT_SECONDS = 10;

export const getDeployJobClaimLockConfig = (env = process.env) => {
  const parsedTimeout = Number.parseInt(String(env.MEIAO_DEPLOY_JOB_CLAIM_LOCK_TIMEOUT_SECONDS || ''), 10);
  const timeoutSeconds = Number.isFinite(parsedTimeout) && parsedTimeout >= 1 && parsedTimeout <= 120
    ? parsedTimeout
    : DEFAULT_LOCK_TIMEOUT_SECONDS;
  return { lockName: DEFAULT_LOCK_NAME, timeoutSeconds };
};

export const acquireDeployJobClaimLock = async ({ connection, env = process.env }) => {
  const { lockName, timeoutSeconds } = getDeployJobClaimLockConfig(env);
  const [rows] = await connection.query(
    'SELECT GET_LOCK(?, ?) AS acquired',
    [lockName, timeoutSeconds],
  );
  if (Number(rows?.[0]?.acquired) !== 1) {
    const error = new Error('任务领取与部署屏障争用，本次操作已安全中止。');
    error.code = 'deploy_job_claim_lock_timeout';
    throw error;
  }
  return { lockName };
};

export const releaseDeployJobClaimLock = async ({ connection, env = process.env }) => {
  const { lockName } = getDeployJobClaimLockConfig(env);
  const [rows] = await connection.query('SELECT RELEASE_LOCK(?) AS released', [lockName]);
  if (Number(rows?.[0]?.released) !== 1) {
    const error = new Error('任务领取与部署屏障锁未能确认释放。');
    error.code = 'deploy_job_claim_lock_release_failed';
    throw error;
  }
};

export const runWithDeployJobClaimLock = async ({
  pool,
  env = process.env,
  isExecutionPaused,
  claim,
}) => {
  const connection = await pool.getConnection();
  let acquired = false;
  let operationError = null;
  try {
    await acquireDeployJobClaimLock({ connection, env });
    acquired = true;
    if (await Promise.resolve(isExecutionPaused?.())) {
      return { paused: true, value: null };
    }
    return { paused: false, value: await claim(connection) };
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    let releaseError = null;
    if (acquired) {
      try {
        await releaseDeployJobClaimLock({ connection, env });
      } catch (error) {
        releaseError = error;
      }
    }
    if (releaseError) connection.destroy?.();
    else connection.release();
    if (releaseError && !operationError) throw releaseError;
  }
};

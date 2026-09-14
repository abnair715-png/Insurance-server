import bcrypt from 'bcryptjs';
import { AgentModel, type AgentDocument } from '../agents/agent.model';
import { AppError } from '../../utils/AppError';
import { isDuplicateKeyError } from '../../middleware/errorHandler';
import { logger } from '../../config/logger';
import { signSessionToken } from './token.service';
import type { LoginInput, RegisterInput } from './auth.validators';

/** Cost 10 ≈ 60-80 ms per hash on Vercel's runtime: meaningful brute-force
 *  resistance without pushing a serverless login over its time budget. */
const BCRYPT_ROUNDS = 10;

export interface AuthResult {
  /** Serialised via the schema's toJSON transform, which strips `passwordHash`. */
  agent: Record<string, unknown>;
  token: string;
}

function toAuthResult(agent: AgentDocument): AuthResult {
  return {
    agent: agent.toJSON(),
    token: signSessionToken({
      sub: agent.id,
      email: agent.email,
      name: agent.name,
      role: agent.role,
    }),
  };
}

export async function registerAgent(input: RegisterInput): Promise<AuthResult> {
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  try {
    const agent = await AgentModel.create({
      name: input.name,
      email: input.email,
      passwordHash,
      phone: input.phone,
      role: 'AGENT',
    });
    logger.info('agent registered', { agentId: agent.id });
    return toAuthResult(agent);
  } catch (error) {
    // Relying on the unique index rather than a read-then-write check means two
    // concurrent signups with the same email cannot both succeed.
    if (isDuplicateKeyError(error)) {
      throw AppError.conflict('An account with this email already exists.');
    }
    throw error;
  }
}

export async function loginAgent(input: LoginInput): Promise<AuthResult> {
  const agent = await AgentModel.findOne({ email: input.email }).select('+passwordHash');

  // Same message and comparable work for "no such account" and "wrong password",
  // so the endpoint cannot be used to enumerate registered email addresses.
  if (!agent) {
    await bcrypt.compare(input.password, '$2a$10$invalidsaltinvalidsaltinvalidsaltinvalidsaltinva');
    throw AppError.unauthenticated('Invalid email or password.');
  }

  const passwordMatches = await bcrypt.compare(input.password, agent.passwordHash);
  if (!passwordMatches) {
    throw AppError.unauthenticated('Invalid email or password.');
  }

  return toAuthResult(agent);
}

export async function getAgentById(id: string) {
  const agent = await AgentModel.findById(id);
  if (!agent) throw AppError.unauthenticated('Your account no longer exists.');
  return agent.toJSON();
}

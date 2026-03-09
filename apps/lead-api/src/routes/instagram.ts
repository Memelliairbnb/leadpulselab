import type { FastifyInstance } from 'fastify';
import { db } from '@alh/db/src/client';
import {
  instagramAccounts,
  instagramAccountProducts,
  instagramAccountAudiences,
  instagramAccountConfig,
  instagramEngagementLog,
} from '@alh/db/src/schema';
import { eq, and, sql, desc } from 'drizzle-orm';
import { logger } from '@alh/observability';
import { claudeClient } from '@alh/ai';
import { igLogin, igVerify2FA, igGetProfile } from '../services/instagram-auth';

export async function instagramRoutes(app: FastifyInstance) {
  // ─── POST /instagram/connect ────────────────────────────────────────────────
  app.post<{
    Body: { username: string; password: string };
  }>('/connect', async (request, reply) => {
    const { tenantId } = request.ctx;
    const { username, password } = request.body;

    if (!username?.trim() || !password?.trim()) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Username and password are required',
        statusCode: 400,
      });
    }

    try {
      const result = await igLogin(username.trim(), password);

      if (result.status === 'connected' && result.account) {
        // Upsert into instagram_accounts
        const existing = await db
          .select({ id: instagramAccounts.id })
          .from(instagramAccounts)
          .where(
            and(
              eq(instagramAccounts.tenantId, tenantId),
              eq(instagramAccounts.igUsername, result.account.ig_username),
            ),
          )
          .limit(1);

        if (existing.length > 0) {
          await db
            .update(instagramAccounts)
            .set({
              igUserId: result.account.ig_user_id,
              sessionJson: result.session_json || null,
              bioText: result.account.biography,
              profilePicUrl: result.account.profile_pic_url,
              followerCount: result.account.follower_count,
              followingCount: result.account.following_count,
              postCount: result.account.media_count,
              isBusiness: result.account.is_business,
              businessCategory: result.account.category,
              accountStatus: 'active',
              connectedAt: new Date(),
              lastActiveAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(instagramAccounts.id, existing[0].id));
        } else {
          await db.insert(instagramAccounts).values({
            tenantId,
            igUserId: result.account.ig_user_id,
            igUsername: result.account.ig_username,
            sessionJson: result.session_json || null,
            bioText: result.account.biography,
            profilePicUrl: result.account.profile_pic_url,
            followerCount: result.account.follower_count,
            followingCount: result.account.following_count,
            postCount: result.account.media_count,
            isBusiness: result.account.is_business,
            businessCategory: result.account.category,
            accountStatus: 'active',
            connectedAt: new Date(),
            lastActiveAt: new Date(),
          });
        }

        logger.info({ tenantId, igUsername: result.account.ig_username }, 'Instagram account connected');

        return {
          status: 'connected',
          account: {
            ig_username: result.account.ig_username,
            full_name: result.account.full_name,
            follower_count: result.account.follower_count,
            following_count: result.account.following_count,
            is_business: result.account.is_business,
            profile_pic_url: result.account.profile_pic_url,
            biography: result.account.biography,
          },
        };
      }

      if (result.status === 'two_factor_required') {
        // Store pending account with partial session so we can resume after 2FA
        const existing = await db
          .select({ id: instagramAccounts.id })
          .from(instagramAccounts)
          .where(
            and(
              eq(instagramAccounts.tenantId, tenantId),
              eq(instagramAccounts.igUsername, username.trim()),
            ),
          )
          .limit(1);

        if (existing.length > 0) {
          await db
            .update(instagramAccounts)
            .set({
              sessionJson: result.session_json || null,
              accountStatus: 'pending_2fa',
              updatedAt: new Date(),
            })
            .where(eq(instagramAccounts.id, existing[0].id));
        } else {
          await db.insert(instagramAccounts).values({
            tenantId,
            igUsername: username.trim(),
            sessionJson: result.session_json || null,
            accountStatus: 'pending_2fa',
          });
        }

        return {
          status: 'two_factor_required',
          message: 'Enter the 2FA code sent to your device',
        };
      }

      // checkpoint_required
      return {
        status: 'checkpoint_required',
        message: result.message || 'Instagram requires a security challenge. Verify on the Instagram app first.',
      };
    } catch (err) {
      logger.error({ err, tenantId, username }, 'Instagram connect failed');
      const message = err instanceof Error ? err.message : 'Instagram authentication failed';
      return reply.status(500).send({
        error: 'Internal Server Error',
        message,
        statusCode: 500,
      });
    }
  });

  // ─── POST /instagram/verify-2fa ─────────────────────────────────────────────
  app.post<{
    Body: { username: string; code: string };
  }>('/verify-2fa', async (request, reply) => {
    const { tenantId } = request.ctx;
    const { username, code } = request.body;

    if (!username?.trim() || !code?.trim()) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Username and 2FA code are required',
        statusCode: 400,
      });
    }

    try {
      // Retrieve the pending account's partial session
      const accounts = await db
        .select()
        .from(instagramAccounts)
        .where(
          and(
            eq(instagramAccounts.tenantId, tenantId),
            eq(instagramAccounts.igUsername, username.trim()),
          ),
        )
        .limit(1);

      const partialSession = accounts.length > 0 ? accounts[0].sessionJson : undefined;

      const result = await igVerify2FA(username.trim(), code.trim(), partialSession || undefined);

      if (result.status === 'connected' && result.account) {
        // Update the account record
        if (accounts.length > 0) {
          await db
            .update(instagramAccounts)
            .set({
              igUserId: result.account.ig_user_id,
              sessionJson: result.session_json || null,
              bioText: result.account.biography,
              profilePicUrl: result.account.profile_pic_url,
              followerCount: result.account.follower_count,
              followingCount: result.account.following_count,
              postCount: result.account.media_count,
              isBusiness: result.account.is_business,
              businessCategory: result.account.category,
              accountStatus: 'active',
              connectedAt: new Date(),
              lastActiveAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(instagramAccounts.id, accounts[0].id));
        }

        logger.info({ tenantId, igUsername: result.account.ig_username }, 'Instagram 2FA verified, account connected');

        return {
          status: 'connected',
          account: {
            ig_username: result.account.ig_username,
            full_name: result.account.full_name,
            follower_count: result.account.follower_count,
            following_count: result.account.following_count,
            is_business: result.account.is_business,
            profile_pic_url: result.account.profile_pic_url,
            biography: result.account.biography,
          },
        };
      }

      return reply.status(400).send({
        error: 'Bad Request',
        message: '2FA verification failed',
        statusCode: 400,
      });
    } catch (err) {
      logger.error({ err, tenantId, username }, 'Instagram 2FA verification failed');
      const message = err instanceof Error ? err.message : '2FA verification failed';
      return reply.status(500).send({
        error: 'Internal Server Error',
        message,
        statusCode: 500,
      });
    }
  });

  // ─── POST /instagram/accounts ───────────────────────────────────────────────
  app.post<{
    Body: {
      accounts: Array<{
        ig_username: string;
        niche?: string;
        products?: Array<{ name: string; description?: string }>;
        audiences?: Array<{ name: string; description?: string }>;
        config?: {
          auto_follow?: boolean;
          auto_like?: boolean;
          auto_comment?: boolean;
          auto_dm?: boolean;
          auto_content?: boolean;
          daily_follow_limit?: number;
          daily_like_limit?: number;
          daily_comment_limit?: number;
          daily_dm_limit?: number;
          engagement_enabled?: boolean;
          content_enabled?: boolean;
        };
      }>;
    };
  }>('/accounts', async (request, reply) => {
    const { tenantId } = request.ctx;
    const { accounts: accountsInput } = request.body;

    if (!accountsInput?.length) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'At least one account is required',
        statusCode: 400,
      });
    }

    try {
      const createdIds: number[] = [];

      for (const acct of accountsInput) {
        // Find the existing account row
        const existing = await db
          .select({ id: instagramAccounts.id })
          .from(instagramAccounts)
          .where(
            and(
              eq(instagramAccounts.tenantId, tenantId),
              eq(instagramAccounts.igUsername, acct.ig_username),
            ),
          )
          .limit(1);

        let accountId: number;

        if (existing.length > 0) {
          accountId = existing[0].id;
          // Update niche if provided
          if (acct.niche) {
            await db
              .update(instagramAccounts)
              .set({
                confirmedNiche: acct.niche,
                updatedAt: new Date(),
              })
              .where(eq(instagramAccounts.id, accountId));
          }
        } else {
          // Create new account
          const [inserted] = await db
            .insert(instagramAccounts)
            .values({
              tenantId,
              igUsername: acct.ig_username,
              confirmedNiche: acct.niche || null,
              accountStatus: 'pending',
            })
            .returning({ id: instagramAccounts.id });
          accountId = inserted.id;
        }

        // Insert products
        if (acct.products?.length) {
          await db.insert(instagramAccountProducts).values(
            acct.products.map((p) => ({
              accountId,
              productName: p.name,
              productDescription: p.description || null,
            })),
          );
        }

        // Insert audiences
        if (acct.audiences?.length) {
          await db.insert(instagramAccountAudiences).values(
            acct.audiences.map((a) => ({
              accountId,
              audienceName: a.name,
              audienceDescription: a.description || null,
            })),
          );
        }

        // Upsert config
        if (acct.config) {
          const existingConfig = await db
            .select({ id: instagramAccountConfig.id })
            .from(instagramAccountConfig)
            .where(eq(instagramAccountConfig.accountId, accountId))
            .limit(1);

          if (existingConfig.length > 0) {
            await db
              .update(instagramAccountConfig)
              .set({
                autoFollow: acct.config.auto_follow ?? undefined,
                autoLike: acct.config.auto_like ?? undefined,
                autoComment: acct.config.auto_comment ?? undefined,
                autoDm: acct.config.auto_dm ?? undefined,
                autoContent: acct.config.auto_content ?? undefined,
                dailyFollowLimit: acct.config.daily_follow_limit ?? undefined,
                dailyLikeLimit: acct.config.daily_like_limit ?? undefined,
                dailyCommentLimit: acct.config.daily_comment_limit ?? undefined,
                dailyDmLimit: acct.config.daily_dm_limit ?? undefined,
                engagementEnabled: acct.config.engagement_enabled ?? undefined,
                contentEnabled: acct.config.content_enabled ?? undefined,
                updatedAt: new Date(),
              })
              .where(eq(instagramAccountConfig.accountId, accountId));
          } else {
            await db.insert(instagramAccountConfig).values({
              accountId,
              autoFollow: acct.config.auto_follow ?? true,
              autoLike: acct.config.auto_like ?? true,
              autoComment: acct.config.auto_comment ?? true,
              autoDm: acct.config.auto_dm ?? false,
              autoContent: acct.config.auto_content ?? false,
              dailyFollowLimit: acct.config.daily_follow_limit ?? 10,
              dailyLikeLimit: acct.config.daily_like_limit ?? 30,
              dailyCommentLimit: acct.config.daily_comment_limit ?? 5,
              dailyDmLimit: acct.config.daily_dm_limit ?? 0,
              engagementEnabled: acct.config.engagement_enabled ?? false,
              contentEnabled: acct.config.content_enabled ?? false,
            });
          }
        }

        createdIds.push(accountId);
      }

      logger.info({ tenantId, accountIds: createdIds }, 'Instagram accounts saved with config');

      return reply.status(201).send({
        message: 'Accounts saved successfully',
        accountIds: createdIds,
      });
    } catch (err) {
      logger.error({ err, tenantId }, 'Failed to save Instagram accounts');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to save accounts',
        statusCode: 500,
      });
    }
  });

  // ─── GET /instagram/accounts ────────────────────────────────────────────────
  app.get('/', async (request, reply) => {
    const { tenantId } = request.ctx;

    try {
      // Get all accounts for this tenant
      const accounts = await db
        .select()
        .from(instagramAccounts)
        .where(eq(instagramAccounts.tenantId, tenantId))
        .orderBy(desc(instagramAccounts.createdAt));

      // Enrich each account with config, products, audiences, and today's stats
      const enriched = await Promise.all(
        accounts.map(async (account) => {
          const [config, products, audiences, todayStats] = await Promise.all([
            db
              .select()
              .from(instagramAccountConfig)
              .where(eq(instagramAccountConfig.accountId, account.id))
              .limit(1),
            db
              .select()
              .from(instagramAccountProducts)
              .where(eq(instagramAccountProducts.accountId, account.id)),
            db
              .select()
              .from(instagramAccountAudiences)
              .where(eq(instagramAccountAudiences.accountId, account.id)),
            db
              .select({
                actionType: instagramEngagementLog.actionType,
                count: sql<number>`count(*)::int`,
              })
              .from(instagramEngagementLog)
              .where(
                and(
                  eq(instagramEngagementLog.accountId, account.id),
                  sql`${instagramEngagementLog.createdAt} >= CURRENT_DATE`,
                ),
              )
              .groupBy(instagramEngagementLog.actionType),
          ]);

          const statsMap: Record<string, number> = {};
          for (const row of todayStats) {
            statsMap[row.actionType] = row.count;
          }

          return {
            id: account.id,
            ig_username: account.igUsername,
            ig_user_id: account.igUserId,
            bio_text: account.bioText,
            profile_pic_url: account.profilePicUrl,
            follower_count: account.followerCount,
            following_count: account.followingCount,
            post_count: account.postCount,
            is_business: account.isBusiness,
            business_category: account.businessCategory,
            detected_niche: account.detectedNiche,
            confirmed_niche: account.confirmedNiche,
            account_status: account.accountStatus,
            connected_at: account.connectedAt,
            last_active_at: account.lastActiveAt,
            config: config[0]
              ? {
                  auto_follow: config[0].autoFollow,
                  auto_like: config[0].autoLike,
                  auto_comment: config[0].autoComment,
                  auto_dm: config[0].autoDm,
                  auto_content: config[0].autoContent,
                  daily_follow_limit: config[0].dailyFollowLimit,
                  daily_like_limit: config[0].dailyLikeLimit,
                  daily_comment_limit: config[0].dailyCommentLimit,
                  daily_dm_limit: config[0].dailyDmLimit,
                  engagement_enabled: config[0].engagementEnabled,
                  content_enabled: config[0].contentEnabled,
                  ramp_week: config[0].rampWeek,
                }
              : null,
            products: products.map((p) => ({
              id: p.id,
              name: p.productName,
              description: p.productDescription,
              is_active: p.isActive,
            })),
            audiences: audiences.map((a) => ({
              id: a.id,
              name: a.audienceName,
              description: a.audienceDescription,
              is_active: a.isActive,
            })),
            today_stats: {
              follows: statsMap['follow'] || 0,
              likes: statsMap['like'] || 0,
              comments: statsMap['comment'] || 0,
              dms: statsMap['dm'] || 0,
            },
          };
        }),
      );

      return { accounts: enriched };
    } catch (err) {
      logger.error({ err, tenantId }, 'Failed to list Instagram accounts');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve accounts',
        statusCode: 500,
      });
    }
  });

  // ─── PUT /instagram/accounts/:id/config ─────────────────────────────────────
  app.put<{
    Params: { id: string };
    Body: {
      auto_follow?: boolean;
      auto_like?: boolean;
      auto_comment?: boolean;
      auto_dm?: boolean;
      auto_content?: boolean;
      daily_follow_limit?: number;
      daily_like_limit?: number;
      daily_comment_limit?: number;
      daily_dm_limit?: number;
      engagement_enabled?: boolean;
      content_enabled?: boolean;
      ramp_week?: number;
    };
  }>('/accounts/:id/config', async (request, reply) => {
    const { tenantId } = request.ctx;
    const accountId = parseInt(request.params.id, 10);

    if (isNaN(accountId)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid account ID',
        statusCode: 400,
      });
    }

    // Verify account belongs to tenant
    const account = await db
      .select({ id: instagramAccounts.id })
      .from(instagramAccounts)
      .where(
        and(
          eq(instagramAccounts.id, accountId),
          eq(instagramAccounts.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!account.length) {
      return reply.status(404).send({
        error: 'Not Found',
        message: `Account ${accountId} not found`,
        statusCode: 404,
      });
    }

    try {
      const body = request.body;
      const updateData: Record<string, unknown> = { updatedAt: new Date() };

      if (body.auto_follow !== undefined) updateData.autoFollow = body.auto_follow;
      if (body.auto_like !== undefined) updateData.autoLike = body.auto_like;
      if (body.auto_comment !== undefined) updateData.autoComment = body.auto_comment;
      if (body.auto_dm !== undefined) updateData.autoDm = body.auto_dm;
      if (body.auto_content !== undefined) updateData.autoContent = body.auto_content;
      if (body.daily_follow_limit !== undefined) updateData.dailyFollowLimit = body.daily_follow_limit;
      if (body.daily_like_limit !== undefined) updateData.dailyLikeLimit = body.daily_like_limit;
      if (body.daily_comment_limit !== undefined) updateData.dailyCommentLimit = body.daily_comment_limit;
      if (body.daily_dm_limit !== undefined) updateData.dailyDmLimit = body.daily_dm_limit;
      if (body.engagement_enabled !== undefined) updateData.engagementEnabled = body.engagement_enabled;
      if (body.content_enabled !== undefined) updateData.contentEnabled = body.content_enabled;
      if (body.ramp_week !== undefined) updateData.rampWeek = body.ramp_week;

      // Upsert config
      const existingConfig = await db
        .select({ id: instagramAccountConfig.id })
        .from(instagramAccountConfig)
        .where(eq(instagramAccountConfig.accountId, accountId))
        .limit(1);

      if (existingConfig.length > 0) {
        await db
          .update(instagramAccountConfig)
          .set(updateData)
          .where(eq(instagramAccountConfig.accountId, accountId));
      } else {
        await db.insert(instagramAccountConfig).values({
          accountId,
          autoFollow: body.auto_follow ?? true,
          autoLike: body.auto_like ?? true,
          autoComment: body.auto_comment ?? true,
          autoDm: body.auto_dm ?? false,
          autoContent: body.auto_content ?? false,
          dailyFollowLimit: body.daily_follow_limit ?? 10,
          dailyLikeLimit: body.daily_like_limit ?? 30,
          dailyCommentLimit: body.daily_comment_limit ?? 5,
          dailyDmLimit: body.daily_dm_limit ?? 0,
          engagementEnabled: body.engagement_enabled ?? false,
          contentEnabled: body.content_enabled ?? false,
          rampWeek: body.ramp_week ?? 1,
        });
      }

      logger.info({ tenantId, accountId }, 'Instagram account config updated');

      return { message: 'Config updated', accountId };
    } catch (err) {
      logger.error({ err, tenantId, accountId }, 'Failed to update Instagram account config');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update config',
        statusCode: 500,
      });
    }
  });

  // ─── DELETE /instagram/accounts/:id ─────────────────────────────────────────
  app.delete<{
    Params: { id: string };
  }>('/accounts/:id', async (request, reply) => {
    const { tenantId } = request.ctx;
    const accountId = parseInt(request.params.id, 10);

    if (isNaN(accountId)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid account ID',
        statusCode: 400,
      });
    }

    try {
      const account = await db
        .select({ id: instagramAccounts.id })
        .from(instagramAccounts)
        .where(
          and(
            eq(instagramAccounts.id, accountId),
            eq(instagramAccounts.tenantId, tenantId),
          ),
        )
        .limit(1);

      if (!account.length) {
        return reply.status(404).send({
          error: 'Not Found',
          message: `Account ${accountId} not found`,
          statusCode: 404,
        });
      }

      // Soft delete: disable and clear session
      await db
        .update(instagramAccounts)
        .set({
          accountStatus: 'disabled',
          sessionJson: null,
          encryptedPassword: null,
          updatedAt: new Date(),
        })
        .where(eq(instagramAccounts.id, accountId));

      logger.info({ tenantId, accountId }, 'Instagram account disconnected');

      return { message: 'Account disconnected', accountId };
    } catch (err) {
      logger.error({ err, tenantId, accountId }, 'Failed to disconnect Instagram account');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to disconnect account',
        statusCode: 500,
      });
    }
  });

  // ─── POST /instagram/accounts/:id/detect-niche ─────────────────────────────
  app.post<{
    Params: { id: string };
  }>('/accounts/:id/detect-niche', async (request, reply) => {
    const { tenantId } = request.ctx;
    const accountId = parseInt(request.params.id, 10);

    if (isNaN(accountId)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid account ID',
        statusCode: 400,
      });
    }

    try {
      const accounts = await db
        .select()
        .from(instagramAccounts)
        .where(
          and(
            eq(instagramAccounts.id, accountId),
            eq(instagramAccounts.tenantId, tenantId),
          ),
        )
        .limit(1);

      if (!accounts.length) {
        return reply.status(404).send({
          error: 'Not Found',
          message: `Account ${accountId} not found`,
          statusCode: 404,
        });
      }

      const account = accounts[0];

      // Try to get recent posts if we have a session
      let recentCaptions: string[] = [];
      if (account.sessionJson) {
        try {
          const profile = await igGetProfile(account.sessionJson);
          recentCaptions = profile.recent_captions;
        } catch (profileErr) {
          logger.warn({ err: profileErr, accountId }, 'Could not fetch profile for niche detection, using bio only');
        }
      }

      const systemPrompt = `You are an expert at analyzing Instagram business accounts to determine their niche, products/services, and target audience. Respond ONLY with valid JSON.`;

      const userPrompt = `Analyze this Instagram account and determine their niche, suggest products/services they likely offer, and identify their target audiences.

Account: @${account.igUsername}
Bio: ${account.bioText || 'No bio available'}
Business category: ${account.businessCategory || 'Not set'}
Is business account: ${account.isBusiness ? 'Yes' : 'No'}
Followers: ${account.followerCount || 'Unknown'}
${recentCaptions.length > 0 ? `\nRecent post captions:\n${recentCaptions.map((c, i) => `${i + 1}. ${c}`).join('\n')}` : ''}

Respond with this exact JSON structure:
{
  "detected_niche": "primary niche/industry",
  "niche_confidence": 0.0-1.0,
  "suggested_products": [
    { "name": "product/service name", "description": "brief description" }
  ],
  "suggested_audiences": [
    { "name": "audience segment name", "description": "who they are and why they'd be interested" }
  ],
  "analysis_notes": "brief explanation of your analysis"
}`;

      const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
      const response = await claudeClient.messages.create({
        model,
        max_tokens: 1024,
        temperature: 0.3,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const textBlock = response.content.find((b: { type: string }) => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error('Claude returned no text content');
      }

      // Extract JSON from response
      let jsonStr = textBlock.text;
      const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (fenceMatch) jsonStr = fenceMatch[1].trim();
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) jsonStr = jsonMatch[0];

      const analysis = JSON.parse(jsonStr);

      // Save detected niche to the account
      if (analysis.detected_niche) {
        await db
          .update(instagramAccounts)
          .set({
            detectedNiche: analysis.detected_niche,
            updatedAt: new Date(),
          })
          .where(eq(instagramAccounts.id, accountId));
      }

      logger.info({ tenantId, accountId, niche: analysis.detected_niche }, 'Niche detection completed');

      return analysis;
    } catch (err) {
      logger.error({ err, tenantId, accountId }, 'Failed to detect niche');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to detect niche',
        statusCode: 500,
      });
    }
  });
}

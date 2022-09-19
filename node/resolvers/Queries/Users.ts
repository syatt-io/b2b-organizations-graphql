import {
  ORGANIZATION_DATA_ENTITY,
  ORGANIZATION_FIELDS,
  ORGANIZATION_SCHEMA_VERSION,
  schemas,
} from '../../mdSchema'
import { toHash } from '../../utils'
import GraphQLError, { getErrorMessage } from '../../utils/GraphQLError'
import { getAppId } from '../config'

const SCROLL_AWAIT_TIME = 100
const SLEEP_ADD_PERCENTAGE = 0.1
const SCROLL_SIZE = 1000
/**
 * Checks the permissions by applying the following rules:
 * @param checkUserPermission
 */
const isSalesAdmin = (checkUserPermission: any) =>
  checkUserPermission?.role.slug.match(/sales-admin/) || false

const getCheckUserPermission = async ({
  storefrontPermissions,
  logger,
}: any) => {
  const {
    data: { checkUserPermission },
  }: any = await storefrontPermissions
    .checkUserPermission('vtex.b2b-organizations@1.x')
    .catch((error: any) => {
      logger.error({
        error,
        message: 'checkUserPermission-error',
      })

      return {
        data: {
          checkUserPermission: null,
        },
      }
    })

  return checkUserPermission
}

const getChannels = async (ctx: Context) => {
  const {
    clients: { vbase },
    vtex: { logger },
  } = ctx

  let channels = {}

  try {
    channels = await vbase.getJSON('b2borg', 'salesChannels')
  } catch (err) {
    if (err.response.status === 404) {
      await vbase.saveJSON('b2borg', 'salesChannels', {})
    } else {
      logger.error({
        error: err,
        message: 'getChannels-Error',
      })
    }
  }

  return channels
}

/**
 * Checks the user permissions and returns the organizationId updated
 * @param validateUserAdmin
 * @param vtex
 * @param storefrontPermissions
 * @param adminUserAuthToken
 * @param organizationId
 * @param logger
 */
const checkUserPermissions = async ({
  validateUserAdmin,
  vtex,
  storefrontPermissions,
  adminUserAuthToken,
  organizationId,
  logger,
}: any) => {
  const { sessionData } = vtex
  const { checkUserPermission } = await getCheckUserPermission({
    logger,
    storefrontPermissions,
  })

  const condition = validateUserAdmin
    ? !adminUserAuthToken && !isSalesAdmin(checkUserPermission)
    : !adminUserAuthToken

  if (condition) {
    if (!sessionData?.namespaces['storefront-permissions']) {
      throw new GraphQLError('organization-data-not-found')
    }

    const {
      organization: { value: userOrganizationId },
    } = sessionData?.namespaces['storefront-permissions']

    if (!organizationId) {
      // get user's organization from session
      organizationId = userOrganizationId
    }

    if (organizationId !== userOrganizationId) {
      throw new GraphQLError('operation-not-permitted')
    }
  }

  return { organizationId }
}

const sleep = (ms: number) => {
  const time = ms + SLEEP_ADD_PERCENTAGE * ms

  return new Promise(resolve => setTimeout(resolve, time))
}

const Users = {
  getAppSettings: async (_: void, __: void, ctx: Context) => {
    const {
      clients: { apps, masterdata },
    } = ctx

    const app: string = getAppId()
    const settings = await apps.getAppSettings(app)

    if (!settings.adminSetup) {
      settings.adminSetup = {}
    }

    const currHash = toHash(schemas)

    if (
      !settings.adminSetup?.schemaHash ||
      settings.adminSetup?.schemaHash !== currHash
    ) {
      const updates: any = []

      schemas.forEach(schema => {
        updates.push(
          masterdata
            .createOrUpdateSchema({
              dataEntity: schema.name,
              schemaBody: schema.body,
              schemaName: schema.version,
            })
            .then(() => true)
            .catch((e: any) => {
              if (e.response.status !== 304) {
                throw e
              }

              return true
            })
        )
      })

      await Promise.all(updates)
        .then(() => {
          settings.adminSetup.schemaHash = currHash
        })
        .catch(e => {
          if (e.response.status !== 304) {
            throw new Error(e)
          }
        })

      await apps.saveAppSettings(app, settings)
    }

    return settings
  },

  getOrganizationsWithoutSalesManager: async (
    _: void,
    __: void,
    ctx: Context
  ) => {
    const {
      clients: { storefrontPermissions, masterdata },
      vtex: { adminUserAuthToken, logger },
    } = ctx

    const { checkUserPermission } = await getCheckUserPermission({
      logger,
      storefrontPermissions,
    })

    if (!adminUserAuthToken && !isSalesAdmin(checkUserPermission)) {
      throw new GraphQLError('operation-not-permitted')
    }

    // getting all users
    const users = await storefrontPermissions
      .listAllUsers()
      .then((result: any) => {
        return result.data.listAllUsers
      })
      .catch(error => {
        logger.error({
          error,
          message: 'getOrganizationsWithoutSalesManager-getUsers-error',
        })
        throw new GraphQLError(getErrorMessage(error))
      })

    let token: string | undefined
    let hasMore = true
    const organizations = [] as any[]

    const scrollMasterData = async () => {
      await sleep(SCROLL_AWAIT_TIME)
      const {
        mdToken,
        data,
      }: {
        mdToken: string
        data: any
      } = await masterdata.scrollDocuments({
        dataEntity: ORGANIZATION_DATA_ENTITY,
        fields: ORGANIZATION_FIELDS,
        mdToken: token,
        schema: ORGANIZATION_SCHEMA_VERSION,
        size: SCROLL_SIZE,
      })

      if (!data.length && token) {
        hasMore = false
      }

      if (!token && mdToken) {
        token = mdToken
      }

      organizations.push(...data)
      if (hasMore) {
        await scrollMasterData()
      }
    }

    try {
      await scrollMasterData()
    } catch (error) {
      logger.error({
        error,
        message: 'scrollMasterData-error',
      })
      throw new GraphQLError(getErrorMessage(error))
    }

    return organizations.filter(organization => {
      return !users
        .filter((user: any) => user.role === 'sales-manager')
        .find((user: any) => user.orgId === organization.id)
    })
  },

  getUsers: async (
    _: void,
    {
      organizationId,
      costCenterId,
    }: { organizationId: string; costCenterId: string },
    ctx: Context
  ) => {
    const {
      clients: { storefrontPermissions },
      vtex: { adminUserAuthToken, logger },
      vtex,
    } = ctx

    const { organizationId: orgId } = await checkUserPermissions({
      adminUserAuthToken,
      logger,
      organizationId,
      storefrontPermissions,
      validateUserAdmin: false,
      vtex,
    })

    organizationId = orgId

    const variables = {
      ...(organizationId && { organizationId }),
      ...(costCenterId && { costCenterId }),
    }

    return storefrontPermissions
      .listUsers(variables)
      .then((result: any) => {
        return result.data.listUsers
      })
      .catch(error => {
        logger.error({
          error,
          message: 'getUsers-getUsers-error',
        })

        throw new GraphQLError(getErrorMessage(error))
      })
  },

  getUsersPaginated: async (
    _: void,
    {
      organizationId,
      costCenterId,
      search = '',
      page = 1,
      pageSize = 25,
      sortOrder = 'asc',
      sortedBy = 'email',
    }: {
      organizationId: string
      costCenterId: string
      search: string
      page: number
      pageSize: number
      sortOrder: string
      sortedBy: string
    },
    ctx: Context
  ) => {
    const {
      clients: { storefrontPermissions },
      vtex: { adminUserAuthToken, logger },
      vtex,
    } = ctx

    const { organizationId: orgId } = await checkUserPermissions({
      adminUserAuthToken,
      logger,
      organizationId,
      storefrontPermissions,
      validateUserAdmin: true,
      vtex,
    })

    organizationId = orgId

    const variables = {
      ...(organizationId && { organizationId }),
      ...(costCenterId && { costCenterId }),
      page,
      pageSize,
      search,
      sortOrder,
      sortedBy,
    }

    return storefrontPermissions
      .listUsersPaginated(variables)
      .then((result: any) => {
        return result.data.listUsersPaginated
      })
      .catch(error => {
        logger.error({
          error,
          message: 'getUsers-error',
        })
        throw new GraphQLError(getErrorMessage(error))
      })
  },

  getSalesChannels: async (_: void, __: void, ctx: Context) => {
    return getChannels(ctx)
  },

  getBinding: async (_: void, { email }: { email: string }, ctx: Context) => {
    const {
      clients: { catalog },
      vtex: { logger },
    } = ctx

    let access = false
    let availableSalesChannels: any = {}

    try {
      availableSalesChannels = await catalog
        .salesChannelAvailable(email)
        .then((res: any) => {
          return res.map((item: any) => {
            return item.Id.toString()
          })
        })
    } catch {
      logger.info({
        message: 'getBinding-availableSalesChannels',
        data: { email },
      })
    }

    try {
      const selectedChannels: any = await getChannels(ctx).then((res: any) => {
        if (res.length) {
          return res.map((item: any) => {
            return item.id
          })
        }

        return null
      })

      if (availableSalesChannels.length) {
        access =
          selectedChannels?.filter((item: any) =>
            availableSalesChannels?.includes(item)
          ).length > 0
      }
    } catch (err) {
      logger.warn({
        error: err,
        message: 'getBinding-Error',
      })
    }

    return access
  },
}

export default Users

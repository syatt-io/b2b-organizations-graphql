import { SchemaDirectiveVisitor } from 'graphql-tools'
import type { GraphQLField } from 'graphql'
import { defaultFieldResolver } from 'graphql'
import { AuthenticationError, ForbiddenError } from '@vtex/api'

export class CheckUserAccess extends SchemaDirectiveVisitor {
  public visitFieldDefinition(field: GraphQLField<any, any>) {
    const { resolve = defaultFieldResolver } = field

    field.resolve = async (
      root: any,
      args: any,
      context: Context,
      info: any
    ) => {
      const {
        vtex: { adminUserAuthToken, storeUserAuthToken, logger },
        clients: { identity, vtexId },
      } = context

      let token = adminUserAuthToken

      if (!token && !storeUserAuthToken) {
        throw new AuthenticationError('No admin or store token was provided')
      }

      if (token) {
        if (context?.headers['x-vtex-credential']) {
          token = context?.headers['x-vtex-credential'] as string
        }

        try {
          await identity.validateToken({ token })
        } catch (err) {
          logger.warn({
            error: err,
            message: 'CheckUserAccess: Invalid admin token',
            token,
          })
          throw new ForbiddenError('Unauthorized Access')
        }
      } else if (storeUserAuthToken) {
        let authUser = null

        try {
          authUser = await vtexId.getAuthenticatedUser(storeUserAuthToken)
          if (!authUser?.user) {
            authUser = null
          }
        } catch (err) {
          logger.warn({
            error: err,
            message: 'CheckUserAccess: Invalid store user token',
            token: storeUserAuthToken,
          })
          authUser = null
        }

        if (!authUser) {
          throw new ForbiddenError('Unauthorized Access')
        }
      }

      return resolve(root, args, context, info)
    }
  }
}

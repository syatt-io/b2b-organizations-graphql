import GraphQLError from '../../utils/GraphQLError'
import checkConfig from '../config'

export const B2B_SETTINGS_DOCUMENT_ID = 'b2bSettings'

const B2BSettings = {
  saveB2BSettings: async (
    _: void,
    {
      input: {
        autoApprove,
        defaultPaymentTerms,
        defaultPriceTables,
        organizationCustomFields,
        costCenterCustomFields,
      },
    }: {
      input: B2BSettingsInput
      page: number
      pageSize: number
    },
    ctx: Context
  ) => {
    const {
      clients: { vbase },
      vtex: { logger },
    } = ctx

    // create schema if it doesn't exist
    await checkConfig(ctx)

    const B2B_SETTINGS_DATA_ENTITY = 'b2b_settings'

    // Get current settings to save them depending on where the saveB2BSettings is coming from. Custom fields come without autoApprove settings and vice versa.
    const currentB2BSettings: B2BSettingsInput = await vbase.getJSON(
      B2B_SETTINGS_DATA_ENTITY,
      'settings'
    )

    try {
      const b2bSettings = {
        // in case property is not present inside input grab it from  currentB2BSettings
        autoApprove: autoApprove ?? currentB2BSettings?.autoApprove,
        defaultPaymentTerms:
          defaultPaymentTerms ?? currentB2BSettings?.defaultPaymentTerms,
        defaultPriceTables:
          defaultPriceTables ?? currentB2BSettings?.defaultPriceTables,
        organizationCustomFields:
          organizationCustomFields ??
          currentB2BSettings?.organizationCustomFields,
        costCenterCustomFields:
          costCenterCustomFields ?? currentB2BSettings?.costCenterCustomFields,
      }

      await vbase.saveJSON(B2B_SETTINGS_DATA_ENTITY, 'settings', b2bSettings)

      return {
        status: 'success',
      }
    } catch (e) {
      logger.error({
        message: 'saveB2BSettings-error',
        error: e,
      })
      if (e.message) {
        throw new GraphQLError(e.message)
      } else if (e.response?.data?.message) {
        throw new GraphQLError(e.response.data.message)
      } else {
        throw new GraphQLError(e)
      }
    }
  },
}

export default B2BSettings

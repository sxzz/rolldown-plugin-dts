import type { infer as Infer } from 'zod'
import { z } from 'zod'

export const productSchema = z.object({
  id: z.string(),
  price: z.number(),
})
export const product: Infer<typeof productSchema> = {
  id: 'abc123',
  price: 19.99,
}

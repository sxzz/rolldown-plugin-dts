import { WidgetProps } from './wrapper'
export interface ConsumerProps extends Omit<WidgetProps, 'id'> {
  id: string
}
export declare function Consumer(props: ConsumerProps): null

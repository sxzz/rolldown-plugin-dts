function Decorator(target: any) {}
function Accessor(target: any, context: ClassAccessorDecoratorContext) {}

@Decorator
export class Product {
  @Accessor
  accessor price = 100
}

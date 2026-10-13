import { RestaurantMenu } from '../../../features/restaurants/restaurant-menu';

export default async function RestaurantPage({
  params,
}: {
  params: Promise<{ restaurantId: string }>;
}) {
  const { restaurantId } = await params;
  return <RestaurantMenu restaurantId={restaurantId} />;
}

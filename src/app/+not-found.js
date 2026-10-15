import { Redirect } from "expo-router";

export default function NotFoundScreen() {
  // This instantly redirects any unmatched route to your main screen
  return <Redirect href="/" />;
}

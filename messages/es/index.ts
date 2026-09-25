/**
 * es: may lag behind English while translation is in progress. Any key
 * missing here falls back to the English text at runtime (src/i18n/messages.ts),
 * and the parity test fails until it is filled in.
 */
import Common from "./common.json";
import LocaleSwitcher from "./localeSwitcher.json";
import Nav from "./nav.json";
import ErrorPage from "./errorPage.json";
import Errors from "./errors.json";
import Validation from "./validation.json";
import Auth from "./auth.json";
import Dashboard from "./dashboard.json";
import Onboarding from "./onboarding.json";
import Notifications from "./notifications.json";
import Search from "./search.json";
import Orders from "./orders.json";
import Analytics from "./analytics.json";
import Payments from "./payments.json";
import Settings from "./settings.json";
import Products from "./products.json";
import ProductPage from "./productPage.json";
import Storefront from "./storefront.json";

const messages = {
  Common,
  LocaleSwitcher,
  Nav,
  ErrorPage,
  Errors,
  Validation,
  Auth,
  Dashboard,
  Onboarding,
  Notifications,
  Search,
  Orders,
  Analytics,
  Payments,
  Settings,
  Products,
  ProductPage,
  Storefront,
};

export default messages;

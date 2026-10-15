import React from "react";

const ContextModule = React.createContext();

class ContextProvider extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      value: {
        // Use Your own default values
      },
    };
  }

  setValue = (value, then = () => {}) => {
    this.setState(
      {
        value: {
          ...this.state.value,
          ...value,
        },
      },
      () => then(),
    );
  };

  setValueAsync = async (value, then = () => {}) => {
    await new Promise((resolve) =>
      this.setState(
        {
          value: {
            ...this.state.value,
            ...value,
          },
        },
        () => resolve(),
      ),
    );
    then();
  };

  render() {
    const { children } = this.props;
    const { value } = this.state;
    const { setValue, setValueAsync } = this;

    return (
      <ContextModule.Provider value={{ value, setValue, setValueAsync }}>
        {children}
      </ContextModule.Provider>
    );
  }
}

export { ContextProvider };
export const ContextConsumer = ContextModule.Consumer;
export default ContextModule;
